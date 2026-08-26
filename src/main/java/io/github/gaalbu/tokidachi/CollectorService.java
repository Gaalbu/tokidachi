package io.github.gaalbu.tokidachi;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.time.Clock;
import java.util.List;

final class CollectorService {
    private final ObjectMapper mapper;
    private final Clock clock;
    private final CacheStore cacheStore;
    private final List<UsageProvider> providers;

    CollectorService(ObjectMapper mapper, Clock clock, CacheStore cacheStore, List<UsageProvider> providers) {
        this.mapper = mapper;
        this.clock = clock;
        this.cacheStore = cacheStore;
        this.providers = List.copyOf(providers);
    }

    ObjectNode collectAll() {
        ObjectNode cached = cacheStore.read();
        long now = clock.instant().getEpochSecond();
        ObjectNode providerResults = mapper.createObjectNode();
        ObjectNode cacheProviders = mapper.createObjectNode();

        for (UsageProvider provider : providers) {
            ObjectNode previous = cacheStore.freshProvider(cached, provider.name(), now);
            try {
                ObjectNode current = provider.collect();
                providerResults.set(provider.name(), withMetadata(provider, current));
                cacheProviders.set(provider.name(), cacheEntry(now, current));
            } catch (ProviderException error) {
                providerResults.set(provider.name(), withMetadata(
                        provider, failure(error.getMessage(), error.configured(), previous)));
                if (previous != null) {
                    cacheProviders.set(provider.name(), previous);
                }
            } catch (RuntimeException error) {
                providerResults.set(provider.name(), withMetadata(provider, failure(
                        "Unexpected " + provider.metadata().displayName() + " collector error",
                        previous != null, previous)));
                if (previous != null) {
                    cacheProviders.set(provider.name(), previous);
                }
            }
        }

        ObjectNode result = mapper.createObjectNode();
        result.put("version", 1);
        result.put("updatedAt", now);
        result.set("providers", providerResults);

        ObjectNode nextCache = mapper.createObjectNode();
        nextCache.put("version", 2);
        nextCache.set("providers", cacheProviders);
        cacheStore.write(nextCache);
        return result;
    }

    private ObjectNode failure(String message, boolean configured, ObjectNode previous) {
        ObjectNode result = mapper.createObjectNode();
        result.put("status", previous == null ? "error" : "stale");
        result.put("configured", configured || previous != null);
        result.put("message", message);
        result.set("windows", previous == null
                ? mapper.createArrayNode() : previous.path("windows").deepCopy());
        result.set("notices", previous == null
                ? mapper.createArrayNode() : arrayCopy(previous.path("notices")));
        return result;
    }

    private ObjectNode cacheEntry(long now, ObjectNode provider) {
        ObjectNode result = mapper.createObjectNode();
        result.put("cachedAt", now);
        result.set("windows", arrayCopy(provider.path("windows")));
        result.set("notices", arrayCopy(provider.path("notices")));
        return result;
    }

    private ArrayNode arrayCopy(JsonNode value) {
        return value instanceof ArrayNode array ? array.deepCopy() : mapper.createArrayNode();
    }

    private ObjectNode withMetadata(UsageProvider provider, ObjectNode result) {
        ProviderMetadata metadata = provider.metadata();
        result.put("displayName", metadata.displayName());
        result.put("color", metadata.color());
        result.put("pet", metadata.pet());
        return result;
    }
}
