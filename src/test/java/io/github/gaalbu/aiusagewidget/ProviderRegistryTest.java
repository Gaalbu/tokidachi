package io.github.gaalbu.aiusagewidget;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.net.http.HttpClient;
import java.time.Clock;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ProviderRegistryTest {
    @Test
    void createsEverySupportedProviderInDisplayOrder() {
        var providers = ProviderRegistry.create(
                new ObjectMapper(), HttpClient.newHttpClient(), Clock.systemUTC(), Map.of());

        assertEquals(java.util.List.of("claude", "codex"),
                providers.stream().map(UsageProvider::name).toList());
    }
}
