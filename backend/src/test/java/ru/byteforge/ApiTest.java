package ru.byteforge;

import com.google.gson.*;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.net.URI;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ApiTest {
    @TempDir Path dir;
    Store store;
    HttpServer server;
    String base;
    static { System.setProperty("sun.net.http.allowRestrictedHeaders", "true"); }
    final Gson json = new Gson();
    @BeforeEach void start() throws Exception {
        store = new Store("jdbc:h2:file:" + dir.resolve("forum")); server = Main.server(store, 0);
        base = "http://127.0.0.1:" + server.getAddress().getPort() + "/api";
    }
    @AfterEach void stop() throws Exception {
        server.stop(0);
        store.close();
    }

    JsonElement call(String method, String path, String token, Object body, int status) throws Exception {
        var req = (HttpURLConnection) URI.create(base + path).toURL().openConnection();
        req.setRequestMethod(method); req.setRequestProperty("Origin", "http://localhost:4173");
        if (token != null) req.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) {
            req.setRequestProperty("Content-Type", "application/json"); req.setDoOutput(true);
            try (var stream = req.getOutputStream()) { stream.write(json.toJson(body).getBytes(StandardCharsets.UTF_8)); }
        }
        int code = req.getResponseCode(); String text;
        try (var stream = code >= 400 ? req.getErrorStream() : req.getInputStream()) {
            text = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
        assertEquals(status, code, text);
        assertEquals("http://localhost:4173", req.getHeaderField("Access-Control-Allow-Origin"));
        JsonElement data = JsonParser.parseString(text);
        if (status >= 400) assertTrue(data.getAsJsonObject().get("message").getAsString().matches(".*[А-Яа-я].*"));
        return data;
    }
    JsonObject login(String nick) throws Exception {
        return call("POST", "/auth/login", null, Map.of("username", nick), 200).getAsJsonObject();
    }
    String token(String nick) throws Exception {
        return login(nick).get("token").getAsString();
    }
    JsonObject post(String token, String category) throws Exception {
        return call("POST", "/posts", token, Map.of("title", "Проверка", "body", "раз\nдва", "categoryId", category,
                "author", "Подмена", "authorId", "u_000"), 201).getAsJsonObject();
    }
    long techCount() throws Exception {
        var cats = call("GET", "/categories", null, null, 200).getAsJsonArray(); assertEquals(5, cats.size());
        for (var item : cats) if (item.getAsJsonObject().get("id").getAsString().equals("tech")) return item.getAsJsonObject().get("postCount").getAsLong();
        throw new AssertionError("Нет tech");
    }

    @Test void lifecycle() throws Exception {
        var login = login("Богдан"); var user = login.getAsJsonObject("user"); String token = login.get("token").getAsString();
        assertEquals(user, login("богдан").get("user")); assertEquals(0, techCount());

        var first = post(token, "tech"); String path = "/posts/" + first.get("id").getAsString();
        assertEquals(Set.of("id","title","body","categoryId","authorId","author","createdAt"), first.keySet());
        assertEquals(user.get("id"), first.get("authorId")); assertEquals("Богдан", first.get("author").getAsString());
        assertEquals("раз\nдва", first.get("body").getAsString()); Instant.parse(first.get("createdAt").getAsString());

        var second = post(token, "general"); assertEquals(1, techCount());
        assertEquals(second, call("GET", "/posts", null, null, 200).getAsJsonArray().get(0));

        var filtered = call("GET", "/posts?categoryId=tech", null, null, 200).getAsJsonArray();
        assertEquals(1, filtered.size()); assertEquals(first, filtered.get(0));
        call("DELETE", path, token("Артём"), null, 403);

        var deleted = call("DELETE", path, token, null, 200).getAsJsonObject();
        assertTrue(deleted.get("ok").getAsBoolean()); assertEquals(first.get("id"), deleted.get("id"));
        call("DELETE", path, token, null, 404); assertEquals(0, techCount());
    }
    @Test void invalidRequests() throws Exception {
        for (String name : List.of("я", "-ник", "а б", "x".repeat(25))) call("POST", "/auth/login", null, Map.of("username", name), 422);
        call("POST", "/posts", null, Map.of(), 401); call("DELETE", "/posts/p_1", "garbage", null, 401);
        String token = token("Ёж-1_2");
        for (var p : List.of(Map.of("title","ab","body","x","categoryId","tech"), Map.of("title","x".repeat(141),"body","x","categoryId","tech"),
                Map.of("title","abc","body"," ","categoryId","tech"),Map.of("title","abc","body","x".repeat(3001),"categoryId","tech"),
                Map.of("title","abc","body","x","categoryId","missing"),Map.of("title",123,"body","x","categoryId","tech"))) call("POST", "/posts",token,p,422);
    }
    @Test void preflight() throws Exception {
        var req = (HttpURLConnection) URI.create(base + "/posts/p_1").toURL().openConnection();
        req.setRequestProperty("Origin", "http://localhost:4173"); req.setRequestMethod("OPTIONS");
        req.setRequestProperty("Access-Control-Request-Method", "DELETE");
        req.setRequestProperty("Access-Control-Request-Headers", "authorization,content-type");
        assertEquals(204, req.getResponseCode());
        assertTrue(req.getHeaderField("Access-Control-Allow-Methods").contains("DELETE"));
        String headers = req.getHeaderField("Access-Control-Allow-Headers");
        req.disconnect();
        assertTrue(headers.contains("Authorization") && headers.contains("Content-Type"));
    }
    @Test void survivesRestart() throws Exception {
        String token = token("Автор"); JsonObject post = post(token, "tech"); stop(); start();
        assertEquals(1, techCount()); call("DELETE", "/posts/" + post.get("id").getAsString(), token, null, 200);
    }
}
