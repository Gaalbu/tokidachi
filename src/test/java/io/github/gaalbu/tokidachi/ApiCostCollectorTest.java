package io.github.gaalbu.tokidachi;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ApiCostCollectorTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @TempDir
    Path temporaryDirectory;

    @Test
    void leavesProviderDataUntouchedWithoutOptInConfiguration() {
        var result = mapper.createObjectNode();
        result.withObject("providers").withObject("codex");

        new ApiCostCollector(mapper, Clock.systemUTC(), HttpClient.newHttpClient(), Map.of(),
                temporaryDirectory.resolve("api-usage.json")).enrich(result);

        assertEquals(false, result.path("providers").path("codex").has("apiUsage"));
    }

    @Test
    void reportsMissingAdminKeyOnlyAfterCodexOptIn() throws Exception {
        Path config = temporaryDirectory.resolve("api-usage.json");
        Files.writeString(config, "{\"apiUsage\":{\"codex\":{\"enabled\":true}}}");
        var result = mapper.createObjectNode();
        result.withObject("providers").withObject("codex");

        new ApiCostCollector(mapper, Clock.systemUTC(), HttpClient.newHttpClient(), Map.of(), config).enrich(result);

        assertEquals("unauthenticated", result.path("providers").path("codex")
                .path("apiUsage").path("status").asText());
    }

    @Test
    void addsAConfiguredProviderUsingItsSelectedCollector() throws Exception {
        Path config = temporaryDirectory.resolve("api-usage.json");
        Files.writeString(config, """
                {"apiUsage":{"providers":[{
                  "id":"team-openai",
                  "displayName":"Team OpenAI",
                  "collector":"openai-costs",
                  "enabled":true
                }]}}
                """);
        var result = mapper.createObjectNode();
        result.withObject("providers");

        new ApiCostCollector(mapper, Clock.systemUTC(), HttpClient.newHttpClient(), Map.of(), config).enrich(result);

        var provider = result.path("providers").path("team-openai");
        assertEquals("Team OpenAI", provider.path("displayName").asText());
        assertEquals(true, provider.path("configured").asBoolean());
        assertEquals("unauthenticated", provider.path("apiUsage").path("status").asText());
    }

    @Test
    void keepsAnUnknownCollectorOfflineAndReportsItAsUnavailable() throws Exception {
        Path config = temporaryDirectory.resolve("api-usage.json");
        Files.writeString(config, """
                {"apiUsage":{"providers":[{
                  "id":"future-ai", "collector":"future-costs", "enabled":true
                }]}}
                """);
        var result = mapper.createObjectNode();
        result.withObject("providers");

        new ApiCostCollector(mapper, Clock.systemUTC(), HttpClient.newHttpClient(), Map.of(), config).enrich(result);

        assertEquals("unavailable", result.path("providers").path("future-ai")
                .path("apiUsage").path("status").asText());
    }

    @Test
    void sumsOpenAiCostBucketsInOneCurrency() throws Exception {
        var response = mapper.readTree("""
                {"data":[
                  {"results":[{"amount":{"currency":"usd","value":1.25}}]},
                  {"results":[{"amount":{"currency":"usd","value":2.25}}]}
                ]}
                """);

        ApiCostCollector.Cost total = ApiCostCollector.parseOpenAiCosts(response);

        assertEquals("USD", total.currency());
        assertEquals(new BigDecimal("3.50"), total.amount());
    }

    @Test
    void rejectsMixedCurrenciesFromOpenAi() throws Exception {
        var response = mapper.readTree("""
                {"data":[
                  {"results":[{"amount":{"currency":"usd","value":1}}]},
                  {"results":[{"amount":{"currency":"eur","value":1}}]}
                ]}
                """);

        assertThrows(IllegalArgumentException.class,
                () -> ApiCostCollector.parseOpenAiCosts(response));
    }
}
