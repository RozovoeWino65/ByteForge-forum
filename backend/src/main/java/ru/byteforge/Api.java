package ru.byteforge;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.util.Map;

final class Api implements HttpHandler {
    private static final Gson JSON = new GsonBuilder().setStrictness(Strictness.STRICT).create();
    private final Store store;
    Api(Store store) { this.store = store; }

    public void handle(HttpExchange x) throws IOException {
        try {
            String origin = x.getRequestHeaders().getFirst("Origin");
            if (origin != null) {
                if (!"http://localhost:4173".equals(origin) && !"http://127.0.0.1:4173".equals(origin))
                    throw new ApiError(403, "Запрос с этого сайта не разрешён");
                x.getResponseHeaders().set("Access-Control-Allow-Origin", origin);
                x.getResponseHeaders().set("Vary", "Origin");
            }
            if (x.getRequestMethod().equals("OPTIONS")) {
                x.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
                x.getResponseHeaders().set("Access-Control-Allow-Headers", "Authorization, Content-Type");
                x.sendResponseHeaders(204, -1);
                return;
            }
            route(x);
        } catch (ApiError e) { send(x, e.status, Map.of("message", e.getMessage())); }
        catch (SQLException e) {
            System.err.println("Ошибка БД. SQLState: " + e.getSQLState());
            send(x, 500, Map.of("message", "Ошибка базы данных"));
        } finally { x.close(); }
    }

    private void route(HttpExchange x) throws IOException, SQLException {
        String method = x.getRequestMethod(), path = x.getRequestURI().getPath();
        switch (path) {
            case "/api/auth/login": {
                require(method, "POST");
                String name = field(body(x), "username", "Введите никнейм");
                if (name.length() < 2 || name.length() > 24 || !name.matches("[\\p{L}\\p{N}][\\p{L}\\p{N}_-]*"))
                    throw new ApiError(422, "Никнейм: от 2 до 24 символов. Начните с буквы или цифры; дальше разрешены также _ и -");
                send(x, 200, store.login(name)); return;
            }
            case "/api/categories":
                require(method, "GET"); send(x, 200, store.categories()); return;
            case "/api/posts":
                if (method.equals("GET")) { send(x, 200, store.posts(categoryFilter(x))); return; }
                require(method, "POST");
                String authorId = authorize(x);
                JsonObject post = body(x);
                String title = field(post, "title", "Введите заголовок").replaceAll("(?U)\\s+", " ");
                String text = field(post, "body", "Напишите текст поста");
                if (title.length() < 3 || title.length() > 140) throw new ApiError(422, "Длина заголовка — от 3 до 140 символов");
                if (text.isEmpty() || text.length() > 3000) throw new ApiError(422, "Длина текста — от 1 до 3000 символов");
                send(x, 201, store.create(title, text, field(post, "categoryId", "Выберите категорию"), authorId)); return;
            default:
                if (path.matches("/api/posts/[^/]+")) {
                    require(method, "DELETE"); send(x, 200, store.delete(path.substring(11), authorize(x))); return;
                }
                throw new ApiError(404, "Адрес не найден");
        }
    }

    private String authorize(HttpExchange x) throws SQLException {
        return store.authenticate(x.getRequestHeaders().getFirst("Authorization"));
    }
    private static void require(String actual, String expected) {
        if (!actual.equals(expected)) throw new ApiError(405, "Метод не поддерживается");
    }
    private static String categoryFilter(HttpExchange x) {
        String raw = x.getRequestURI().getRawQuery();
        if (raw != null) for (String item : raw.split("&")) {
            String[] pair = item.split("=", 2);
            if (URLDecoder.decode(pair[0], StandardCharsets.UTF_8).equals("categoryId"))
                return pair.length == 2 ? URLDecoder.decode(pair[1], StandardCharsets.UTF_8) : "";
        }
        return null;
    }
    private static JsonObject body(HttpExchange x) throws IOException {
        String type = x.getRequestHeaders().getFirst("Content-Type");
        if (type == null || !type.split(";", 2)[0].trim().equalsIgnoreCase("application/json"))
            throw new ApiError(415, "Требуется Content-Type: application/json");
        byte[] bytes = x.getRequestBody().readNBytes(32769);
        if (bytes.length > 32768) throw new ApiError(413, "Слишком большой запрос");
        try {
            JsonObject obj = JSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonObject.class);
            if (obj != null) return obj;
        } catch (JsonParseException ignored) { /* common error response below */ }
        throw new ApiError(400, "Ожидается объект JSON");
    }
    private static String field(JsonObject obj, String key, String message) {
        JsonElement value = obj.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) throw new ApiError(422, message);
        return value.getAsString().replaceAll("^[\\s\\p{Z}\\uFEFF]+|[\\s\\p{Z}\\uFEFF]+$", "");
    }
    private static void send(HttpExchange x, int status, Object payload) throws IOException {
        byte[] bytes = JSON.toJson(payload).getBytes(StandardCharsets.UTF_8);
        x.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        x.getResponseHeaders().set("Cache-Control", "no-store");
        x.sendResponseHeaders(status, bytes.length);
        x.getResponseBody().write(bytes);
    }
}
