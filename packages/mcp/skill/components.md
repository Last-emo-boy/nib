# Components and instances

A component is any node with `reusable: true`. An instance is a `ref` node that displays a copy of a component: `{type: "ref", ref: componentId}`. Changing the component changes every instance.

Use components for anything that repeats: buttons, inputs, list rows, cards, nav items, avatars. Give the component's parts names (`"Label"`, `"Icon"`, `"Value"`): instances override them by id or name.

## Making a component

Build it like any frame, with `reusable: true`, somewhere visible on the canvas (a "Components" area beside the screens):

```js
button = Insert(document, {type: "frame", name: "Button", reusable: true, x: 0, y: 1200, padding: [10, 16], gap: 8, alignItems: "center", cornerRadius: 8, fill: "$accent"})
buttonLabel = Insert(button, {type: "text", name: "Label", content: "Button", fontSize: 14, fontWeight: "500", fill: "$on-accent"})
```

An existing frame becomes a component with `Update(id, {reusable: true})`.

## Instances

```js
Insert(form, {type: "ref", ref: button, descendants: {Label: {content: "Save changes"}}})
Insert(form, {type: "ref", ref: button, fill: "$surface", descendants: {[buttonLabel]: {content: "Cancel", fill: "$text"}}})
```

- Properties on the `ref` node itself, other than `ref` and `descendants`, override the component root: `fill`, `width`, `padding`, ...
- `descendants` maps a node inside the component (by id, by id path for nested instances, or by unique name) to property overrides.
- `Copy(componentId, parent)` also makes an instance.

## Changing one instance

Address nodes inside an instance with paths, `instanceId + "/" + childId`:

```js
Update(saveBtn + "/" + buttonLabel, {content: "Publish"})
```

That writes `descendants` on the instance; the component stays as it is. Nested instances take longer paths: `card + "/" + headerInstance + "/" + titleId`.

- **Hide a part:** `Update(path, {enabled: false})`. Parts of instances cannot be deleted.
- **Swap a part:** `Replace(path, {type: "icon", icon: "trash", width: 16, height: 16, fill: "$danger"})` replaces that part in this instance only and returns the new part's path.
- **Add content to a frame inside an instance** (a slot): `Insert(card + "/" + bodyId, {...})`. The instance gets its own children list for that frame, starting from the component's.

## Reading instances

`Get(instanceId)` shows the `ref` node with its overrides. `Get(instanceId, {resolveInstances: true})` shows what it displays, with ids as paths. Visitors walk into instances, so `Get(screen, n => ...)` sees and can update every displayed text, including those inside instances.

## Components of components

A component may contain instances of other components, and an instance may itself be a component (`{type: "ref", ref: base, reusable: true, ...}`): a variant that shares the base's structure. Override keys of such a variant address the base's nodes.

## Other files

A document can import another .pen file (`imports: {ui: "./ui-kit.pen"}`); its components are then used as `ref: "ui:buttonId"` and its variables as `"$ui:accent"`. Imported nodes cannot be edited from this document.
