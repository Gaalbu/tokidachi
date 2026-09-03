package io.github.gaalbu.tokidachi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;

final class OpenCodeProvider implements UsageProvider {
    private final ObjectMapper mapper;
    private final Clock clock;
    private final Map<String, String> environment;
    private final Path dbPathOverride;

    OpenCodeProvider(ObjectMapper mapper, Clock clock, Map<String, String> environment) {
        this(mapper, clock, environment, null);
    }

    OpenCodeProvider(ObjectMapper mapper, Clock clock, Map<String, String> environment, Path dbPathOverride) {
        this.mapper = mapper;
        this.clock = clock;
        this.environment = environment;
        this.dbPathOverride = dbPathOverride;
    }

    @Override
    public String name() {
        return "opencode";
    }

    @Override
    public ProviderMetadata metadata() {
        return new ProviderMetadata("OpenCode", "#7c3aed", "pets/opencode.svg");
    }

    @Override
    public ObjectNode collect() throws ProviderException {
        Path dbPath = resolveDbPath();
        if (!Files.isRegularFile(dbPath)) {
            throw new ProviderException("OpenCode database not found", false);
        }
        long nowMs = clock.millis();
        long fiveHoursAgo = nowMs - 5L * 3600 * 1000;
        long sevenDaysAgo = nowMs - 7L * 24 * 3600 * 1000;
        long todayStart = LocalDate.now(clock).atStartOfDay(clock.getZone()).toInstant().toEpochMilli();

        int count5h = 0;
        int countToday = 0;
        int count7d = 0;

        String url = "jdbc:sqlite:" + dbPath;
        try {
            Class.forName("org.sqlite.JDBC");
        } catch (ClassNotFoundException e) {
            throw new ProviderException("SQLite driver not available", true, e);
        }
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement ps = conn.prepareStatement("SELECT time_created, data FROM message WHERE data IS NOT NULL");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                long tc = rs.getLong(1);
                String data = rs.getString(2);
                if (data == null) continue;
                JsonNode node;
                try {
                    node = mapper.readTree(data);
                } catch (Exception ignored) {
                    continue;
                }
                String role = node.path("role").asText("");
                if (!"assistant".equals(role)) continue;
                if (!isFreeOpencodeModel(node)) continue;
                if (tc >= fiveHoursAgo) count5h++;
                if (tc >= todayStart) countToday++;
                if (tc >= sevenDaysAgo) count7d++;
            }
        } catch (Exception e) {
            throw new ProviderException("Could not read OpenCode database", true, e);
        }

        ObjectNode result = mapper.createObjectNode();
        result.put("status", "ok");
        result.put("configured", true);
        ArrayNode windows = result.putArray("windows");
        windows.add(countWindow("Last 5 hours", count5h));
        windows.add(countWindow("Today", countToday));
        windows.add(countWindow("Last 7 days", count7d));
        result.set("notices", mapper.createArrayNode());
        return result;
    }

    static boolean isFreeOpencodeModel(JsonNode node) {
        JsonNode model = node.path("model");
        String providerId = null;
        String modelId = null;
        if (model.isObject()) {
            providerId = model.path("providerID").asText(null);
            modelId = model.path("modelID").asText(null);
        }
        if (providerId == null) providerId = node.path("providerID").asText(null);
        if (modelId == null) modelId = node.path("modelID").asText(null);
        if (!"opencode".equals(providerId)) return false;
        if (modelId == null || modelId.isBlank()) return false;
        return "big-pickle".equals(modelId) || modelId.endsWith("-free");
    }

    private ObjectNode countWindow(String label, int count) {
        ObjectNode w = mapper.createObjectNode();
        w.put("kind", "count");
        w.put("label", label);
        w.put("count", count);
        w.putNull("resetLabel");
        return w;
    }

    private Path resolveDbPath() {
        if (dbPathOverride != null) return dbPathOverride;
        String override = environment.get("OPENCODE_DB");
        if (override != null && !override.isBlank()) return Path.of(override);
        String xdg = environment.get("XDG_DATA_HOME");
        Path base;
        if (xdg != null && !xdg.isBlank()) base = Path.of(xdg);
        else base = Path.of(environment.getOrDefault("HOME", System.getProperty("user.home")), ".local", "share");
        return base.resolve("opencode").resolve("opencode.db");
    }
}
