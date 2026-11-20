package ru.byteforge;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;

public final class Main {
    static HttpServer server(Store store, int port) throws Exception {
        HttpServer http = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        http.createContext("/", new Api(store));
        http.start();
        return http;
    }

    public static void main(String[] args) throws Exception {
        Store store = new Store("jdbc:h2:file:./data/byteforge");
        HttpServer server = server(store, 3000);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop(0);
            try { store.close(); } catch (Exception e) { e.printStackTrace(); }
        }));
        System.out.println("ByteForge API: http://localhost:3000/api/categories");
    }
}
