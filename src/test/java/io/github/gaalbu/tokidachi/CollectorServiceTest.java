package io.github.gaalbu.tokidachi;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class CollectorServiceTest {
    private static final long NOW = 2_000_000_000L;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Clock clock = Clock.fixed(Instant.ofEpochSecond(NOW), ZoneOffset.UTC);
    @TempDir Path temporary;

    @Test
    void providerFailureDoesNotBlockTheOtherAndFreshCacheKeepsItsAge() {
        CacheStore store = new CacheStore(mapper, temporary.resolve("usage.json"));
        ObjectNode cached = mapper.createObjectNode();
        cached.put("version", 2);
        ObjectNode claude = cached.putObject("providers").putObject("claude");
        claude.put("cachedAt", NOW - 60);
        claude.set("windows", windows());
        claude.putArray("notices").add("1 rate-limit reset available");
        store.write(cached);

        ObjectNode result = new CollectorService(mapper, clock, store,
                List.of(failing("claude", "offline", true), successful("codex"))).collectAll();

        assertEquals("stale", result.path("providers").path("claude").path("status").asText());
        assertEquals("ok", result.path("providers").path("codex").path("status").asText());
        assertEquals("Claude", result.path("providers").path("claude").path("displayName").asText());
        assertEquals("#d97757", result.path("providers").path("claude").path("color").asText());
        assertEquals("pets/claude.svg", result.path("providers").path("claude").path("pet").asText());
        assertEquals("1 rate-limit reset available",
                result.path("providers").path("claude").path("notices").get(0).asText());
        ObjectNode saved = store.read();
        assertEquals(NOW - 60, saved.path("providers").path("claude").path("cachedAt").asLong());
        assertEquals(NOW, saved.path("providers").path("codex").path("cachedAt").asLong());
    }

    @Test
    void expiredCacheIsRemovedAndUnconfiguredProviderIsMarkedHidden() {
        CacheStore store = new CacheStore(mapper, temporary.resolve("usage.json"));
        ObjectNode cached = mapper.createObjectNode();
        cached.put("version", 2);
        ObjectNode claude = cached.putObject("providers").putObject("claude");
        claude.put("cachedAt", NOW - CacheStore.MAX_AGE_SECONDS - 1);
        claude.set("windows", windows());
        store.write(cached);

        ObjectNode result = new CollectorService(mapper, clock, store,
                List.of(failing("claude", "not configured", false), successful("codex"))).collectAll();

        assertEquals("error", result.path("providers").path("claude").path("status").asText());
        assertFalse(result.path("providers").path("claude").path("configured").asBoolean());
        assertFalse(store.read().path("providers").has("claude"));
    }

    private UsageProvider failing(String name, String message, boolean configured) {
        return new UsageProvider() {
            public String name() { return name; }
            public ProviderMetadata metadata() { return metadataFor(name); }
            public ObjectNode collect() throws ProviderException { throw new ProviderException(message, configured); }
        };
    }

    private UsageProvider successful(String name) {
        return new UsageProvider() {
            public String name() { return name; }
            public ProviderMetadata metadata() { return metadataFor(name); }
            public ObjectNode collect() {
                ObjectNode result = mapper.createObjectNode();
                result.put("status", "ok");
                result.put("configured", true);
                result.set("windows", windows());
                return result;
            }
        };
    }

    private ProviderMetadata metadataFor(String name) {
        return new ProviderMetadata(
                Character.toUpperCase(name.charAt(0)) + name.substring(1),
                name.equals("claude") ? "#d97757" : "#4f8cff",
                "pets/" + name + ".svg");
    }

    private ArrayNode windows() {
        ArrayNode result = mapper.createArrayNode();
        ObjectNode window = result.addObject();
        window.put("label", "5-hour window");
        window.put("usedPercent", 25.0);
        window.putNull("resetLabel");
        return result;
    }
}
