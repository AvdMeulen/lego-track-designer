# Domain model

The planner works with **LEGO City plastic train tracks**, not Duplo and not the older 9V metal rails.

Exact element IDs can be refined during catalog work. The important part is a stable geometry model.

## Track part

A catalog item the user can own.

| Field | Meaning |
| --- | --- |
| `id` | Stable app identifier, for example `straight-16` |
| `name` | Display name |
| `legoIds` | Optional official element / design IDs |
| `category` | `straight`, `curve`, `switch`, `crossing`, `flex`, `special` |
| `ports` | Connection points |
| `footprint` | Occupied area used for collision checks |
| `lengthStuds` | Useful for straights |
| `turnDegrees` | Useful for curves, usually `22.5` for a standard City curve |

A standard City curve is typically 22.5 degrees. Sixteen curves make a full circle.

## Port

A place where two parts can click together.

| Field | Meaning |
| --- | --- |
| `id` | Local port name, for example `a` or `b` |
| `offset` | Position relative to the part origin |
| `heading` | Outgoing direction in degrees |
| `kind` | `standard` for City rail connectors |

Two ports connect when their positions coincide (within tolerance) and their headings face each other (180 degrees apart).

## Inventory item

The user's owned quantity of one catalog part.

```ts
interface InventoryItem {
  partId: string;
  quantity: number;
}
```

## Placed part

One physical piece in a generated layout.

```ts
interface PlacedPart {
  instanceId: string;
  partId: string;
  x: number;
  y: number;
  rotation: number;
}
```

## Connection

An edge between two placed ports. The full layout is a graph:

- Nodes are placed parts.
- Edges are connected ports.
- Switches have three ports and create branches.
- A crossing has four ports and can create two independent routes.

## Layout

```ts
interface TrackLayout {
  parts: PlacedPart[];
  connections: Connection[];
  unusedInventory: InventoryItem[];
  score: LayoutScore;
}
```

`LayoutScore` can include compactness, number of used pieces, number of closed loops, and leftover connectors.

## Geometry rules

- Coordinates use a 2D plane in studs or millimeters. Pick one unit and keep it everywhere. **Studs** are the recommended unit.
- Parts must not overlap footprints, except at intended connector faces.
- Open ports are allowed unless the user asks for a closed loop.
- A closed loop means every used standard port is connected, except intentional buffers later.
- Generation must never consume more pieces than inventory.

## First catalog to implement

Start with a small, well-measured set:

1. Straight 16-stud track
2. Standard curve (22.5 degrees)
3. Left switch
4. Right switch
5. 90-degree crossing, if measurements are available

Flexible track can wait. It makes search much harder.

## Measurement approach

Do not guess connector offsets. Measure real pieces or use verified community dimensions, then store them in a catalog JSON file under `src/assets/catalog/`. Include a short comment for the source of each measurement.
