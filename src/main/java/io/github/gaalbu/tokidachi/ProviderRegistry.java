package io.github.gaalbu.tokidachi;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.http.HttpClient;
import java.time.Clock;
import java.util.List;
import java.util.Map;

final class ProviderRegistry {
    private ProviderRegistry() {}

    static List<UsageProvider> create(
            ObjectMapper mapper,
            HttpClient httpClient,
            Clock clock,
            Map<String, String> environment) {
        return List.of(
                new ClaudeProvider(mapper, httpClient, clock, environment),
                new CodexProvider(mapper, clock, environment));
    }
}
