Supporting a new StarCraft II build version (LotV-only)
======================================================

Sometimes when a new version comes out (e.g. build `44401`), Blizzard updates ids used to identify units and abilities.

This repo vendors a subset of sc2reader's lookup data under `sc2readerjs/data/sc2reader/` and uses it from JS.
We only support **Legacy of the Void** (`LotV/`).

Base pack behavior
------------------

The `LotV/base_abilities.csv` and `LotV/base_units.csv` files are the "base pack": a baseline mapping of ids to names.
Each `LotV/<build>_abilities.csv` / `LotV/<build>_units.csv` file is a **patch** that adds/overrides entries on top of
the base pack for that specific build.

When resolving a replay with `baseBuild`, we use:
- exact `LotV/<baseBuild>_abilities.csv` when available
- otherwise the closest `LotV/<build>_abilities.csv` with `<build> <= baseBuild`
- otherwise base-pack only

How to add a new LotV build
---------------------------

1. Install and open the StarCraft II Editor, then navigate to `File` -> `Export Balance Data...` and select the expansion level for the balance data you wish to add, then select the directory which you wish to export the balance data to.
2. Find out the build version this balance data correlates to. One method of doing this is to navigate to the s2protocol repo (https://github.com/Blizzard/s2protocol) and looking at the version of the latest protocol.
At the time of writing, the latest build version is 53644.
3. Execute `sc2reader/generate_build_data.py`, passing the expansion level selected in step 1, the build version determined in step 2, the directory the balance data was exported to in step 1, and the sc2reader project root directory as parameters.
e.g. `python3 sc2reader/generate_build_data.py LotV 53644 balance_data/ sc2reader/`
This will generate the necessary data files (namely, `53644_abilities.csv`, `53644_units.csv`, and updated versions of
`ability_lookup.csv` and `unit_lookup.csv`).
4. Copy the generated `LotV/<build>_abilities.csv` and `LotV/<build>_units.csv` files into `sc2readerjs/data/sc2reader/LotV/`.
5. If sc2reader updated `ability_lookup.csv` / `unit_lookup.csv`, copy those into `sc2readerjs/data/sc2reader/` as well.

If you are not able to see the correct expansion for the balance data, you may need to authenticate. See the instructions at
https://github.com/ggtracker/sc2reader/issues/98#issuecomment-542554588 on how to do that
