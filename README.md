# sc2readerjs

Extracts structured data from StarCraft II replays with an API layer to return readable game information.

## API overview
The public API is exported from `sc2readerjs/src/index.js` and typed in `sc2readerjs/index.d.ts`.
- `loadReplaySummary(replayPath, options?)`
- `loadBuildCommands(replayPath, options?)`
- `loadChat(replayPath, options?)`
- `loadEngagements(replayPath, options?)`
- `loadEcoTimeline(replayPath, options?)`

All functions:

- Take a filesystem `replayPath` (absolute or relative).
- Return times as both `gameloop` and derived `seconds` (using the replay’s scaled/unscaled time setting).
- Support `options.protocolDir` to override where protocol schemas are loaded from (advanced/mostly for development).