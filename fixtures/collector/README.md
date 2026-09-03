# Collector fixtures

These non-secret documents exercise the collector version 1 JSON contract.
Native hosts can use them for rendering tests without credentials or network.

`windows[].usedPercent` is a number from 0 to 100. `status`, `configured`,
`notices`, and optional `message` describe card state. `displayName`, `color`,
and `pet` are collector-owned metadata. `apiUsage` is omitted because it is an
opt-in extension outside the first native-host vertical slice.
