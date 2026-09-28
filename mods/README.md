# Mods

A mod is a folder of JSON, PNGs, and optional scripts. Data is merged onto the base game. Scripts register behavior. A duplicate id throws and names both sources. There is no way to replace a base id.

[cavepaintings.examplemod](cavepaintings.examplemod) is a complete mod. Its scatter chance and structure `attemptChance` are `0`, so those defs never place. Open it beside this page.

## Install

Main menu → Mods.

Electron: Open Mods Folder and drop the mod folder in. An unpackaged `npm run app` also reads this repo's `mods/` directory. When both copies contain the same relative path, the user folder wins.

Browser: Add Mod and pick the folder.

Enable fails until every dependency is already enabled. Disable fails while another enabled mod depends on this one. The screen asks for a reload. The set is fixed once a world starts.

## Folder

```
yourname.mod/
  mod.json
  data/            optional
  assets/items/    item PNGs
  assets/things/   thing PNGs
  sim/index.js     optional, runs on the host
  client/index.js  optional, runs in the browser
```

Every file under `data/` is optional. A missing script is an error only when `mod.json` sets `sim` or `client`.

## mod.json

```json
{
  "id": "yourname.mod",
  "name": "Your Mod",
  "author": "Your Name",
  "description": "Optional. Shown when you hover the mod.",
  "version": "1.0.0",
  "gameVersion": ">=0.3.2",
  "dependencies": [],
  "loadPriority": 0
}
```

`id` is `author.name`: lowercase letters, digits, and underscores, at least one dot. `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`

`dependencies` is an array of mod ids. Use `[]` when there are none. A missing dependency or a cycle throws.

`gameVersion` is compared with [version.json](../version.json). Operators are `>=`, `>`, `<=`, `<`, and `=`, then `x.y.z`. A bare version means `=`.

`name` is the label in the Mods screen. `author` and `version` are stored with the mod. The save and the join check use `version`.

`description` is optional. The Mods screen shows it when you hover the mod.

`loadPriority` defaults to `0`. Among mods whose dependencies are already satisfied, a lower number loads first. Equal priority breaks ties by `id`.

`clientOnly: true` leaves the mod out of the simulation identity. Use it for a client script with no data and no sim script.

`sim` or `client` set to `true` or a path requires `sim/index.js` or `client/index.js`. The files are always those two paths.

## Names

A new def id that is one bare word is prefixed with the mod id. `token` in `yourname.mod` becomes `yourname.mod.token`. An id that is not in your namespace throws.

A reference is prefixed only when this mod defines that short name. Otherwise it stays, so a recipe key `stick` and a prereq `gathering` still mean the base defs. This applies to recipe keys, prereqs, unlock lists, loot item ids, structure piece ids, scatter `thingId`, and the other id fields called out below.

`api.id("token")` always prefixes a bare word. Use it for your own ids. Pass a base id through as the raw string `"stick"`.

## Pictures

Item and thing images are loaded from the mod folder.

`assets/items/<short>.png`
`assets/things/<short>.png`

`<short>` is `key`, or `id` when `key` is omitted, before the mod prefix is added. The texture key in game is the qualified id.

A mob sprite uses `key` when set, otherwise the qualified mob id. Mob PNGs are not picked up from the mod folder. `registerTexture({ key: "critter" })` registers `yourname.mod.critter`, which matches a mob that omits `key`.

## data/items.json

An array of objects. A null entry is skipped.

`id`, `key`, `name`. `tooltip` is an array of strings. `tooltipTech` hides those lines until that tech is unlocked on the holder's settlement.

`maxStack`. `weight` is kilograms. A crafted item's weight is derived from its recipe ingredients divided by `QUANTITY`, unless `weightFixed` is true, in which case `weight` is kept as written.

`beauty` is a figurine score kept on the stack. `fillColor` is a hex color (`#3B6FE0`) used when mixing pigment. `pigment: true` marks a pigment. `storageCategory` overrides the storage-filter bucket for this item.

`place.thing` is the thing id created when the item is placed.

`durability` is the starting tool durability. `digPower` is added while digging. `toolClass` is the tool class (a digging stick is `"digger"`). `use` is a use verb. The base game reads `"light_fire"`. `brain: true` marks the item as brains for hide work. `knapping.material` is the stone the knapping minigame treats this item as.

`hide.animal` is the animal id. `hide.stage` is `fleshed`, `dried`, `soaked`, `brained`, or `leather`.

### recipe

Keys that are item ids map to a count. A bare key is resolved like any other reference.

`QUANTITY` is how many the craft produces, and the divisor for derived weight. `CRAFT_SECONDS` is the craft time. `REQUIRE_THING` and `REQUIRE_STATION` are thing ids that must be nearby. `REQUIRE_TOOL` is a tool id string, or `{ "id", "toolClass", "wear" }`. `wear` is durability spent. `ANY_HIDE` and `ANY_LEATHER` are `{ "qty", "hideStage" }`.

### weapon

`type` (`"melee"`), `range`, `hitStart`, `hitEnd`. The last two are fractions of the swing during which the hit connects.

`attacks` is an array of `{ "id", "name", "verb", "type", "damage", "cooldown", "range", "source", "weightMultiplier", "unarmed" }`. `type` is `sharp` or `blunt`. `weightMultiplier` scales the swing with the wielder. `unarmed` marks an unarmed attack. `source` names where the attack comes from.

### equip

`slot`, `layer` (`belt`, `pack`, or a clothing layer), `covers` (body-part names this piece covers). `armor.sharp` and `armor.blunt`. `effects.speed` is a fraction added to move speed. `effects.strength` is extra carry weight in kilograms. `effects.addSlot` adds an inventory slot.

### food

`kc` is calories. `satietyRatio` is how filling a bite is. `eatSeconds` is the eat channel. `spoil` is hours until it spoils. `autoEat` lets a settler eat it on their own. `foodPoisonChance` is the chance a serving causes food poisoning.

### fuel

`kj` is the energy in the fuel. `temp` is the burn temperature.

### cook

`temp` and `method`. A method block such as `stick_roast` or `smoke_hide` has `minutes`, `result` (item id), and `temp`.

### bandage

`tendQuality` and `tendQualityMax` bound the tend. `channelSeconds` is the tend channel. `batchSeverity` is how much injury severity one tend can cover.

## data/things.json

An array of objects.

`id`, `key`, `name`, `tooltip`. `hitboxSize` is the collision radius. `hitbox` is a list of `[x, y]` pixel offsets for a tighter shape. `footprint` is `[width, height]` in tiles. `rotations` is the allowed angles, from `0`, `90`, `180`, `270`. `interactOffset` is `[dx, dy]` in tiles from the origin to the spot a person stands to work, at rotation 0. South is `[0, 1]`.

`anim.frameWidth`, `anim.frameHeight`, `anim.frameRate`, `anim.repeat`. `repeat` of `-1` loops. A mod thing PNG is loaded as one image. The base game slices `anim` spritesheets from its own thing files.

`lightLevel` is the radius of night light. `lightKind` is `flame` (flicker; `fire` is the same) or `steady`. `lit` starts a campfire lit.

These objects select built-in behavior. A custom thing kind does not run when any of them is set: `lootable`, `campfire`, `storage`, `craftStation`, `settlement`, `figurine`, `sleep`.

`lootable.item` is the harvested item. `lootable.yield` is the count. `lootable.regrowMinutes` is when it grows back. `lootable.transform` is the thing id it becomes when harvested.

`choppable.stump` is the thing id left behind. `diggable.item` and `diggable.yield` are the dig product. `diggable.health` is how long the dig takes. `diggable.drops` maps item id to a count.

`storage.slots` is the slot count. `storage.maxPerSlot` caps a stack in one slot. `storage.accept` limits what the container takes (`"hide"` on the drying rack). `storage.slotLabel` is the slot name in the panel.

`sleep.slots` is how many people can lie down.

`dryingRack: true` makes the thing a drying rack. `paintingCircle: true` makes it a painting circle. `craftStation: true`, `campfire: true`, `settlement: true`, and `figurine: true` are the matching built-in kinds.

## data/techs.json

An array of objects.

`id`, `name`, `era`, `quote`. `cost` is research points. A cost of `0`, or `startUnlocked: true`, makes the tech free from the start. `wip: true` draws the node as unfinished and blocks research. Neolithic and Chalcolithic eras are treated as unfinished even without the flag. `icon` is an item or thing texture key for the tree node. `prereqs` is an array of tech ids. `children` lists techs that require this one. A mod tech is added to each prereq's `children`. You can also write `children` yourself.

`unlocks.items` is item ids this tech gates. An item id claimed by two techs throws when it comes from a mod. `unlocks.jobs` is job ids. `unlocks.bills` is bill ids. `unlocks.text` is lines on the research panel: a string, or `{ "require", "header", "label" }` where `require` is a tech id that locks the line until researched.

## data/mobs.json

An array of objects.

`id`, `key`, `name`. `bodyPlan` is a body-plan id. `speed` and `wanderSpeed`. `hitboxSize`. `ai` is `neutralAnimal` or `scaredAnimal` on the base mobs. `attacks` is stored on the def. Base mobs leave it `[]`. Strikes come from the body plan's `unarmedAttacks` and each part's `attacks` list. `drops` is `{ "item", "min", "max" }`.

`anim.frameWidth` and `anim.frameHeight` are the sprite frame size.

`spawn.tiles` is the tile ids it may appear on. `spawn.chunkChance` is the chance a chunk tries a pack. `spawn.packMin` and `spawn.packMax` bound the pack size. `spawn.packRadius` is how far members scatter. `spawn.minCandidates` is how many open tiles the pack wants.

## data/bodyPlans.json

An object. The key and `id` must match.

`name`, `healRate`, `healthScale`, `painShockThreshold`. `core` is the part name that anchors the body. `fatalParts` lists part names whose loss kills. `showDoll` shows the health doll.

`parts.<Name>` is one body part. `mhp` is max hit points. `coverage` is the chance a hit lands here. `children` and `pairChildren` name the parts inside it; a pair is left and right. `internal` hides it under another part. `delicate` and `alwaysScar` change how injuries land and heal. `fatal` means destroying the part kills. `bleedMult` multiplies bleed. `attacks` is a list of keys into `unarmedAttacks`.

`unarmedAttacks.<id>` is `{ "name", "verb", "type", "damage", "cooldown", "range", "weightMultiplier", "injury", "color" }`. `injury` is an injury id. `color` is the combat-log color. `type` is `sharp` or `blunt`.

## data/injuries.json

An object. The key and `id` must match.

`name`. `type` is `sharp` or `blunt`. `painPerSeverity`. `bleedRate`. `canScar` and `alwaysScar`. `delicate` limits which parts can take it. `infectionChance`.

## data/hediffs.json

An object. The key and `id` must match.

`name`. `initialSeverity` and `lethalSeverity`. `severityPerDay` is the change per day; negative recovers. Infection uses `severityPerDayNotImmune`, `severityPerDayTended`, and `severityPerDayImmune`, plus `immunityPerDaySick` and `immunityPerDayNotSick`. `local` keeps it on one part. `isInfection` and `tendable` mark an infection that can be tended. `baseTendDurationHours` is the tend length.

`stages` is an array of `{ "minSeverity", "label", "painOffset", "lifeThreatening", "vomitMtbDays", "hungerRateFactor", "capacityFactors", "capacityOffsets", "capacityMax" }`. The three capacity fields are maps of capacity name to a number. Base hediffs use `consciousness`, `moving`, `manipulation`, `talking`, `eating`, and `bloodFiltration`. `vomitMtbDays` is the mean days between vomits. `hungerRateFactor` scales hunger.

## data/structures.json

```json
{
  "types": [],
  "lootTables": {}
}
```

A type is a world-gen site. `id`. `salt` is an integer mixed into the placement roll. `cellChunks` is the cell size in chunks. `attemptChance` is the chance a cell tries to place the site, from 0 to 1. The example uses `0`. `innerChebyshev` is the radius, in chunks, kept clear inside the cell. `pad` is extra tiles kept clear around the footprint.

`template.pieces` is `{ "id", "kind", "dx", "dy", "rot", "footprint", "loot" }`. `id` is a thing id. `kind` is the built-in kind (`campfire`, `sleep`, `storage`). `dx` and `dy` are tile offsets. `rot` is the angle. `footprint` is `[width, height]` when it differs from the thing. `loot` is a loot-table id.

A loot table has `stackCount`, an array of `{ "n", "weight" }` for how many of the eight slots get a stack. `weapons` is `{ "id", "chance", "durability", "durabilityFrac" }`. Each weapon's `chance` is added in order until the roll hits; `durabilityFrac` is `[min, max]` of `durability`. Anything left over rolls `junk`: `{ "id", "weight", "min", "max" }`.

## data/scatters.json

An array. The same rows can be registered from the sim script. A repeated id throws.

`id`. `tiles` is tile ids that may receive the thing. `thingId`. `chance` is 0 to 1 per eligible tile. `salt` is an integer. The roll is private to that tile, so editing one scatter does not move the others. The example uses `chance: 0`.

## Scripts

Both files export a factory. The host calls it with `api`. Use this wrapper. The global name is `__cpPendingSimFactory` in `sim/index.js` and `__cpPendingClientFactory` in `client/index.js`.

```js
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory;
    else root.__cpPendingSimFactory = factory;
})(typeof globalThis !== "undefined" ? globalThis : this, function (api) {
});
```

Scripts run with the host's full access. `sim/index.js` runs on the host: the dedicated server, or singleplayer in the browser. `client/index.js` runs in the page, in load order. A dedicated server does not run it.

### Sim api

`api.modId`. `api.id(name)` prefixes a bare word. `registerAction`, `registerJob`, `registerScatter`.

`registerAction({ type, handle(world, session, action) })`. A bare `type` is prefixed. It must not be a built-in protocol action: `chat`, `use`, `light_fire`, `campfire`, `place`, `storage`, `craft`, `pickup`, `harvest`, `spawn_mob`, `drop`, `spawn_drop`, `attack`, `hotbar`, `inv_swap`, `equip`, `unequip`, `equip_swap`, `knap`, `form`, `respawn`, `die`, `tend`, `corpse_take`, `corpse_skin`, `rack_flesh`, `rack_brain`, `corpse_dismiss`, `mob_death`, `command`, `cancel_channel`, `resync`, `sleep`, `recruit`, `switch_control`, `party_eat`, `feed`, `give_item`, `settlement`. A thrown handler is logged and does not stop the tick. An unknown type is ignored.

`registerJob({ id, label, name, work, defaultPriority, busy, planTypes, plan, perform, actLabel })`. `label` is the short name on the work tab. `name` is the longer name. `work` is an array of tooltip lines under that name. `defaultPriority` is 0–4; anything else becomes 3. `busy` defaults to true. `planTypes` defaults to `[id]` and is the plan `type` values this job performs.

`plan(state)` returns `null` or `{ type, target }`. `perform` receives `{ world, rec, settle, plan, delta, runGather, runDig }`. Return `{ halt: true }` to stop that settler's tick. `actLabel` returns the activity string. These ids are reserved: `doctor`, `cook`, `chop`, `leather`, `gather`, `haul`, `research`.

`registerScatter({ id, tiles, thingId, chance, salt })` follows the same rules as `data/scatters.json`.

### Client api

`api.modId`. `api.id(name)`. `registerThingKind`, `registerPanel`, `registerTexture`, `onEvent`.

`registerThingKind({ id, clientClass, panelId, initEntry(def, x, y) })`. The kind matches `def.kind` or `def.id`. Built-in thing flags skip it. `initEntry` returns the world entry, or `{ lootable, entry }`. `clientClass(scene, entry)` returns a `Thing`. `panelId` is the panel opened for this thing.

`registerPanel({ id, open(scene, target) })`.

`registerTexture({ key, url })`. A bare `key` is prefixed. `url` is relative to the mod folder, such as `assets/items/token.png`. A duplicate key throws.

`onEvent(kind, fn)`. `fn` is called with the scene as `this` and the event, after the scene handles that event. Kinds that reach mods: `world_regen`, `chat`, `death`, `channel`, `party_death`, `player_left`, `attack`, `combat_log`, `pvp_hit`, `pvp_clear`, `recruit`, `vomit`, `bleed`, `damage`, `lootable`, `chop`, `dig`, `corpse`, `mob`, `campfire`, `storage`, `thing_set`.

## Order

Dependencies load first. Then `loadPriority`, then `id`. A missing dependency or a cycle throws.

## Multiplayer and saves

Joining requires the same simulation content as the host. A missing mod, an extra mod, a different version, or a different content hash is rejected.

A save stores each sim mod's id and version. Loading without one of those mods warns and leaves that mod's placed content in the world. A hash mismatch warns the same way when every saved mod id is still loaded.
