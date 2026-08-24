package io.github.gaalbu.tokidachi;

import com.fasterxml.jackson.databind.node.ObjectNode;

interface UsageProvider {
    String name();

    ProviderMetadata metadata();

    ObjectNode collect() throws ProviderException;
}
