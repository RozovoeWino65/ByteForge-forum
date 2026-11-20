package ru.byteforge;

import org.h2.tools.RunScript;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.sql.*;
import java.time.OffsetDateTime;
import java.util.*;

/** One embedded database connection. Synchronized operations serialize writes for this local MVP. */
final class Store implements AutoCloseable {
    private final Connection db;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String POST_SELECT = "SELECT p.*, u.username FROM posts p JOIN users u ON u.id=p.author_id ";

    Store(String url) throws SQLException, IOException {
        db = DriverManager.getConnection(url, "sa", "");
        try (Reader script = new InputStreamReader(Objects.requireNonNull(
                Store.class.getResourceAsStream("/schema.sql")), StandardCharsets.UTF_8)) {
            RunScript.execute(db, script);
        }
    }

    private PreparedStatement query(String sql, Object... args) throws SQLException {
        PreparedStatement stmt = db.prepareStatement(sql);
        for (int i = 0; i < args.length; i++) stmt.setObject(i + 1, args[i]);
        return stmt;
    }

    private String scalar(String sql, Object... args) throws SQLException {
        try (var stmt = query(sql, args); var rs = stmt.executeQuery()) {
            return rs.next() ? rs.getString(1) : null;
        }
    }

    private static String digest(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            var hex = new StringBuilder(64);
            for (byte b : digest) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    synchronized Map<?, ?> login(String name) throws SQLException {
        String id = null;
        try (var stmt = query("SELECT id, username FROM users WHERE username=?", name); var rs = stmt.executeQuery()) {
            if (rs.next()) { id = rs.getString("id"); name = rs.getString("username"); }
        }
        if (id == null) {
            id = "u_" + UUID.randomUUID();
            try (var stmt = query("INSERT INTO users(id, username) VALUES (?, ?)", id, name)) { stmt.executeUpdate(); }
        }
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        try (var stmt = query("INSERT INTO sessions(token_hash,user_id) VALUES (?,?)", digest(token), id)) { stmt.executeUpdate(); }
        return Map.of("user", Map.of("id", id, "username", name), "token", token);
    }

    synchronized String authenticate(String header) throws SQLException {
        if (header != null && header.matches("(?i:Bearer) [A-Za-z0-9_-]{43}")) {
            String id = scalar("SELECT user_id FROM sessions WHERE token_hash=?", digest(header.substring(7)));
            if (id != null) return id;
        }
        throw new ApiError(401, "Нужно войти в аккаунт");
    }

    synchronized List<Object> categories() throws SQLException {
        String sql = "SELECT c.id,c.title,c.description,COUNT(p.id) AS total FROM categories c "
                + "LEFT JOIN posts p ON p.category_id=c.id GROUP BY c.id,c.title,c.description,c.position ORDER BY c.position";
        List<Object> result = new ArrayList<>();
        try (var stmt = query(sql); var rs = stmt.executeQuery()) {
            while (rs.next()) result.add(Map.of("id", rs.getString("id"), "title", rs.getString("title"),
                    "description", rs.getString("description"), "postCount", rs.getLong("total")));
        }
        return result;
    }

    private static Map<?, ?> post(ResultSet rs) throws SQLException {
        return Map.of("id", "p_" + rs.getLong("id"), "title", rs.getString("title"), "body", rs.getString("body"),
                "categoryId", rs.getString("category_id"), "authorId", rs.getString("author_id"),
                "author", rs.getString("username"), "createdAt", rs.getObject("created_at", OffsetDateTime.class).toInstant().toString());
    }

    synchronized List<Object> posts(String category) throws SQLException {
        String order = " ORDER BY p.created_at DESC,p.id DESC";
        List<Object> result = new ArrayList<>();
        try (var stmt = category == null ? query(POST_SELECT + order) : query(POST_SELECT + "WHERE p.category_id=?" + order, category);
             var rs = stmt.executeQuery()) {
            while (rs.next()) result.add(post(rs));
        }
        return result;
    }

    synchronized Map<?, ?> create(String title, String body, String category, String authorId) throws SQLException {
        if (scalar("SELECT id FROM categories WHERE id=?", category) == null) throw new ApiError(422, "Такой категории не существует");
        try (var stmt = db.prepareStatement("INSERT INTO posts(title,body,category_id,author_id) VALUES (?,?,?,?)", new String[]{"ID"})) {
            stmt.setString(1, title); stmt.setString(2, body); stmt.setString(3, category); stmt.setString(4, authorId);
            stmt.executeUpdate();
            try (var keys = stmt.getGeneratedKeys()) {
                keys.next();
                try (var read = query(POST_SELECT + "WHERE p.id=?", keys.getLong(1)); var rs = read.executeQuery()) {
                    rs.next(); return post(rs);
                }
            }
        }
    }

    synchronized Map<?, ?> delete(String id, String authorId) throws SQLException {
        long key;
        try {
            if (!id.matches("p_[1-9][0-9]*")) throw new NumberFormatException();
            key = Long.parseLong(id.substring(2));
        } catch (NumberFormatException e) { throw new ApiError(404, "Пост не найден"); }
        try (var stmt = query("DELETE FROM posts WHERE id=? AND author_id=?", key, authorId)) {
            if (stmt.executeUpdate() == 1) return Map.of("ok", true, "id", id);
        }
        if (scalar("SELECT id FROM posts WHERE id=?", key) == null) throw new ApiError(404, "Пост не найден");
        throw new ApiError(403, "Можно удалять только свои посты");
    }

    public synchronized void close() throws SQLException { db.close(); }
}
