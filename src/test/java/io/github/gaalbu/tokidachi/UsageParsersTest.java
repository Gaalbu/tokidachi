package io.github.gaalbu.tokidachi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.DoubleNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.stream.StreamSupport;

import static org.junit.jupiter.api.Assertions.assertEquals;

class UsageParsersTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final Clock clock = Clock.fixed(Instant.parse("2033-05-18T12:00:00Z"), ZoneOffset.UTC);

    @Test
    void parsesClaudeWindows() throws IOException {
        ArrayNode windows = UsageParsers.parseClaude(fixture("claude_usage.json"), clock);
        assertEquals(java.util.List.of("5-hour window", "7-day window"),
                StreamSupport.stream(windows.spliterator(), false).map(n -> n.path("label").asText()).toList());
        assertEquals(java.util.List.of(43.0, 21.0),
                StreamSupport.stream(windows.spliterator(), false).map(n -> n.path("usedPercent").asDouble()).toList());
    }

    @Test
    void parsesCodexWindows() throws IOException {
        ArrayNode windows = UsageParsers.parseCodex(fixture("codex_usage.json"), clock);
        assertEquals(java.util.List.of("5-hour window", "1-week window"),
                StreamSupport.stream(windows.spliterator(), false).map(n -> n.path("label").asText()).toList());
        assertEquals(java.util.List.of(12.0, 31.0),
                StreamSupport.stream(windows.spliterator(), false).map(n -> n.path("usedPercent").asDouble()).toList());
    }

    @Test
    void parsesCurrentCodexLimitsWithoutNullLabels() throws IOException {
        ObjectNode usage = UsageParsers.parseCodexUsage(fixture("codex_usage_current.json"), clock);

        assertEquals(java.util.List.of(
                        "Codex · 5-hour window",
                        "Codex · 1-week window",
                        "Codex · Individual limit",
                        "gpt-reserve · 1-week window"),
                StreamSupport.stream(usage.path("windows").spliterator(), false)
                        .map(n -> n.path("label").asText()).toList());
        assertEquals(75.0, usage.path("windows").get(2).path("usedPercent").asDouble());
        assertEquals("ok", usage.path("status").asText());
        assertEquals("1 rate-limit reset available", usage.path("notices").get(0).asText());
    }

    @Test
    void marksReachedCodexLimitsForAttention() throws IOException {
        ObjectNode payload = (ObjectNode) fixture("codex_usage_current.json");
        ((ObjectNode) payload.path("rateLimitsByLimitId").path("codex"))
                .put("rateLimitReachedType", "workspace_member_credits_depleted");

        ObjectNode usage = UsageParsers.parseCodexUsage(payload, clock);

        assertEquals("attention", usage.path("status").asText());
        assertEquals("Workspace credits are depleted", usage.path("message").asText());
    }

    @Test
    void clampsPercentages() {
        assertEquals(100.0, UsageParsers.window("test", DoubleNode.valueOf(140), null, clock).path("usedPercent").asDouble());
        assertEquals(0.0, UsageParsers.window("test", DoubleNode.valueOf(-4), null, clock).path("usedPercent").asDouble());
    }

    private JsonNode fixture(String name) throws IOException {
        return mapper.readTree(Path.of("tests", "fixtures", name).toFile());
    }
}
