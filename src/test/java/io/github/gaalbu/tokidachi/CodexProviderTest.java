package io.github.gaalbu.tokidachi;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class CodexProviderTest {
    @TempDir Path temporary;

    @Test
    void exchangesJsonRpcWithAppServerProcess() throws IOException, ProviderException {
        assumeTrue(FileSystems.getDefault().supportedFileAttributeViews().contains("posix"));
        Path command = temporary.resolve("codex");
        Files.writeString(command, """
                #!/usr/bin/env bash
                set -euo pipefail
                head -n 3 >/dev/null
                printf '%s\\n' '{"id":2,"result":{"rateLimitsByLimitId":{"codex":{"limitName":null,"primary":{"usedPercent":12,"windowDurationMins":300,"resetsAt":1786237200},"secondary":{"usedPercent":31,"windowDurationMins":10080,"resetsAt":1786823146}}},"rateLimitResetCredits":{"availableCount":1,"credits":[]}}}'
                """);
        Files.setPosixFilePermissions(command, PosixFilePermissions.fromString("rwx------"));

        ObjectMapper mapper = new ObjectMapper();
        Clock clock = Clock.fixed(Instant.ofEpochSecond(2_000_000_000L), ZoneOffset.UTC);
        ObjectNode result = new CodexProvider(mapper, clock, Map.of("CODEX_BIN", command.toString())).collect();

        assertEquals("ok", result.path("status").asText());
        assertTrue(result.path("configured").asBoolean());
        assertEquals(2, result.path("windows").size());
        assertEquals(12.0, result.path("windows").get(0).path("usedPercent").asDouble());
        assertEquals("1 rate-limit reset available", result.path("notices").get(0).asText());
    }

    @Test
    void returnsReachedStateWhenCodexProvidesNoWindows() throws IOException, ProviderException {
        assumeTrue(FileSystems.getDefault().supportedFileAttributeViews().contains("posix"));
        Path command = temporary.resolve("codex-limit-reached");
        Files.writeString(command, """
                #!/usr/bin/env bash
                set -euo pipefail
                head -n 3 >/dev/null
                printf '%s\\n' '{"id":2,"result":{"rateLimitsByLimitId":{"codex":{"primary":null,"secondary":null,"rateLimitReachedType":"rate_limit_reached"}}}}'
                """);
        Files.setPosixFilePermissions(command, PosixFilePermissions.fromString("rwx------"));

        ObjectNode result = new CodexProvider(new ObjectMapper(), Clock.systemUTC(),
                Map.of("CODEX_BIN", command.toString())).collect();

        assertEquals("attention", result.path("status").asText());
        assertEquals("Codex usage limit reached", result.path("message").asText());
        assertTrue(result.path("windows").isEmpty());
    }
}
