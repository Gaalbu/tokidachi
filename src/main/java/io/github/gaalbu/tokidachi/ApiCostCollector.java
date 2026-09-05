package io.github.gaalbu.tokidachi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class ApiCostCollector {
    private static final int MAX_CONFIG_BYTES = 64 * 1024;
    private static final int MAX_RESPONSE_BYTES = 1024 * 1024;
    private static final int DEFAULT_PERIOD_DAYS = 30;

    private final ObjectMapper mapper;
    private final Clock clock;
    private final HttpClient httpClient;
    private final Map<String, String> environment;
    private final Path configPath;

    ApiCostCollector(ObjectMapper mapper, Clock clock, HttpClient httpClient, Map<String, String> environment) {
        this(mapper, clock, httpClient, environment, configPath(environment));
    }

    ApiCostCollector(ObjectMapper mapper, Clock clock, HttpClient httpClient, Map<String, String> environment,
                     Path configPath) {
        this.mapper = mapper;
        this.clock = clock;
        this.httpClient = httpClient;
        this.environment = environment;
        this.configPath = configPath;
    }

    void enrich(ObjectNode result) {
        Settings settings = readSettings();
        ObjectNode providers = result.withObject("providers");
        for (ProviderSetting setting : settings.providers()) {
            if (!setting.enabled())
                continue;
            ObjectNode usage = collect(setting);
            ObjectNode provider = providers.get(setting.id()) instanceof ObjectNode existing
                    ? existing : configuredProvider(setting, usage);
            provider.set("apiUsage", usage);
            if (!providers.has(setting.id()))
                providers.set(setting.id(), provider);
        }
    }

    private ObjectNode collect(ProviderSetting setting) {
        return switch (setting.collector()) {
            case "openai-costs" -> collectOpenAiCosts(setting.periodDays());
            case "anthropic-costs" -> unavailable(
                    "Anthropic API cost collection is not available yet");
            default -> unavailable("The configured API cost collector is not supported");
        };
    }

    private ObjectNode configuredProvider(ProviderSetting setting, ObjectNode usage) {
        ObjectNode provider = mapper.createObjectNode();
        provider.put("displayName", setting.displayName());
        provider.put("configured", true);
        provider.put("status", "ok".equals(usage.path("status").asText()) ? "ok" : "error");
        provider.set("windows", mapper.createArrayNode());
        provider.set("notices", mapper.createArrayNode());
        if (usage.has("message"))
            provider.put("message", usage.path("message").asText());
        return provider;
    }

    private ObjectNode collectOpenAiCosts(int periodDays) {
        String key = environment.get("TOKIDACHI_OPENAI_ADMIN_KEY");
        if (key == null || key.isBlank())
            return unauthenticated("OpenAI organization admin key is not configured");

        Instant end = clock.instant();
        Instant start = end.minus(Duration.ofDays(periodDays));
        HttpRequest request = HttpRequest.newBuilder(URI.create(
                        "https://api.openai.com/v1/organization/costs?start_time="
                                + start.getEpochSecond() + "&end_time=" + end.getEpochSecond()
                                + "&bucket_width=1d"))
                .timeout(Duration.ofSeconds(15))
                .header("Authorization", "Bearer " + key)
                .header("User-Agent", "tokidachi/0.4.0")
                .GET()
                .build();
        try {
            HttpResponse<InputStream> response = httpClient.send(request,
                    HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = response.body()) {
                if (response.statusCode() == 401 || response.statusCode() == 403)
                    return unauthenticated("OpenAI organization admin key was rejected");
                if (response.statusCode() < 200 || response.statusCode() >= 300)
                    return error("OpenAI cost service is unavailable");
                byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
                if (bytes.length > MAX_RESPONSE_BYTES)
                    return error("OpenAI cost response exceeded the safety limit");
                Cost cost = parseOpenAiCosts(mapper.readTree(bytes));
                ObjectNode usage = mapper.createObjectNode();
                usage.put("status", "ok");
                usage.put("periodStart", start.toString());
                usage.put("periodEnd", end.toString());
                usage.put("currency", cost.currency());
                usage.put("estimatedCost", decimal(cost.amount()));
                usage.put("sourceUpdatedAt", end.toString());
                return usage;
            }
        } catch (IOException | InterruptedException exception) {
            if (exception instanceof InterruptedException)
                Thread.currentThread().interrupt();
            return error("OpenAI cost service could not be reached");
        } catch (IllegalArgumentException exception) {
            return error("OpenAI cost response was invalid");
        }
    }

    static Cost parseOpenAiCosts(JsonNode response) {
        JsonNode data = response.path("data");
        if (!data.isArray())
            throw new IllegalArgumentException("data must be an array");
        String currency = null;
        BigDecimal total = BigDecimal.ZERO;
        for (JsonNode bucket : data) {
            JsonNode results = bucket.path("results");
            if (!results.isArray())
                throw new IllegalArgumentException("results must be an array");
            for (JsonNode result : results) {
                JsonNode amount = result.path("amount");
                JsonNode valueNode = amount.path("value");
                if (!amount.isObject() || !valueNode.isNumber()
                        || (valueNode.isFloatingPointNumber() && !Double.isFinite(valueNode.doubleValue())))
                    throw new IllegalArgumentException("amount is invalid");
                String foundCurrency = amount.path("currency").asText("").trim().toUpperCase(Locale.ROOT);
                if (!foundCurrency.matches("[A-Z]{3}"))
                    throw new IllegalArgumentException("currency is invalid");
                BigDecimal value = valueNode.decimalValue();
                if (value.signum() < 0)
                    throw new IllegalArgumentException("cost cannot be negative");
                if (currency != null && !currency.equals(foundCurrency))
                    throw new IllegalArgumentException("mixed currencies");
                currency = foundCurrency;
                total = total.add(value);
            }
        }
        if (currency == null)
            throw new IllegalArgumentException("no costs found");
        return new Cost(currency, total);
    }

    private Settings readSettings() {
        try {
            if (!Files.isRegularFile(configPath, LinkOption.NOFOLLOW_LINKS)
                    || Files.size(configPath) > MAX_CONFIG_BYTES)
                return Settings.DISABLED;
            JsonNode usage = mapper.readTree(Files.readString(configPath)).path("apiUsage");
            if (!usage.isObject())
                return Settings.DISABLED;
            int periodDays = usage.path("periodDays").canConvertToInt()
                    ? usage.path("periodDays").asInt() : DEFAULT_PERIOD_DAYS;
            if (periodDays < 1 || periodDays > 31)
                periodDays = DEFAULT_PERIOD_DAYS;
            return new Settings(readProviders(usage, periodDays));
        } catch (IOException | RuntimeException exception) {
            return Settings.DISABLED;
        }
    }

    private List<ProviderSetting> readProviders(JsonNode usage, int defaultPeriodDays) {
        JsonNode providers = usage.path("providers");
        if (!providers.isArray())
            return legacyProviders(usage, defaultPeriodDays);
        List<ProviderSetting> settings = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (JsonNode provider : providers) {
            if (settings.size() == 8 || !provider.isObject())
                break;
            String id = provider.path("id").asText("").trim();
            String displayName = provider.path("displayName").asText("").trim();
            String collector = provider.path("collector").asText("").trim();
            int periodDays = provider.path("periodDays").canConvertToInt()
                    ? provider.path("periodDays").asInt() : defaultPeriodDays;
            if (!id.matches("[a-z][a-z0-9-]{0,31}") || !ids.add(id)
                    || displayName.length() > 40 || collector.isEmpty())
                continue;
            if (displayName.isEmpty())
                displayName = title(id);
            if (periodDays < 1 || periodDays > 31)
                periodDays = defaultPeriodDays;
            settings.add(new ProviderSetting(id, displayName, collector,
                    provider.path("enabled").asBoolean(false), periodDays));
        }
        return List.copyOf(settings);
    }

    private List<ProviderSetting> legacyProviders(JsonNode usage, int periodDays) {
        List<ProviderSetting> settings = new ArrayList<>();
        if (usage.path("codex").path("enabled").asBoolean(false))
            settings.add(new ProviderSetting("codex", "Codex", "openai-costs", true, periodDays));
        if (usage.path("claude").path("enabled").asBoolean(false))
            settings.add(new ProviderSetting("claude", "Claude", "anthropic-costs", true, periodDays));
        return List.copyOf(settings);
    }

    private static String title(String id) {
        return Character.toUpperCase(id.charAt(0)) + id.substring(1);
    }

    private ObjectNode unavailable(String message) {
        return status("unavailable", message);
    }

    private ObjectNode unauthenticated(String message) {
        return status("unauthenticated", message);
    }

    private ObjectNode error(String message) {
        return status("error", message);
    }

    private ObjectNode status(String status, String message) {
        ObjectNode usage = mapper.createObjectNode();
        usage.put("status", status);
        usage.put("message", message);
        return usage;
    }

    private static String decimal(BigDecimal value) {
        BigDecimal normalized = value.stripTrailingZeros();
        return (normalized.scale() < 0 ? normalized.setScale(0) : normalized).toPlainString();
    }

    private static Path configPath(Map<String, String> environment) {
        String root = environment.get("XDG_CONFIG_HOME");
        if (root == null || root.isBlank())
            root = Path.of(environment.getOrDefault("HOME", System.getProperty("user.home")), ".config").toString();
        return Path.of(root, "tokidachi", "api-usage.json");
    }

    record Cost(String currency, BigDecimal amount) {}

    private record Settings(List<ProviderSetting> providers) {
        private static final Settings DISABLED = new Settings(List.of());
    }

    private record ProviderSetting(String id, String displayName, String collector,
                                   boolean enabled, int periodDays) {}
}
