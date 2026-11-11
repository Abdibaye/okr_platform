# shadcn foundation 1.0.0

The customer request determines features, content, branding, and layout. Use the
installed `components/ui` controls, shared typography, semantic Tailwind colors,
and Lucide interface icons for new UI. Compose custom domain controls from these
primitives. Do not copy Neander's own frontend or mix in a second control library.

Read `.neander/foundation.json`, `components.json`, and the recorded global CSS
before editing. The runtime pins this release; project component copies and CSS
are customer-owned and may be customized. Later turns preserve those changes.
The staged canonical copy under `.neander/foundations/shadcn/1.0.0/` is available
for explicit, scoped repair. Do not reset a theme or replace edited files merely
to make a check pass. Missing/conflicting metadata requires reconciliation.

The conversational agent supplies only an accent in hex and a mood (`neutral`,
`calm`, or `expressive`) on the initial UI coding action. Honor customer branding.
Without a brand or color direction, use the bundled default (`#2563eb`, `neutral`)
and keep the accent limited to primary actions and selected states. Do not invent
an indigo/purple brand or decorative typography for a generic business app.
The runtime derives
the complete light/dark palette and typography preset. `brand-accent` preserves
the requested color; interactive primary, hover/active, focus, sidebar, and chart
tokens may be adjusted for contrast. Surface `accent` is the shadcn neutral
interaction surface, distinct from brand color. Report recorded adjustments.
Use matching foreground tokens, including destructive/success/warning pairs.
Use `.dark` on the document root for dark mode; do not force a theme switcher
into an app unless requested. Fonts are self-hosted through the locked package.

Use `Button`, `Field`, `Input`, `Label`, `Textarea`, `Checkbox`, `RadioGroup`,
`Switch`, `Select`, `Dialog`, `AlertDialog`, `DropdownMenu`, `Popover`, `Tooltip`,
`Tabs`, `Card`, `Badge`, `Table`, `Skeleton`, and `Alert`; `Separator` is included
as a shared dependency. Lucide icons default to 16 px inside controls; use 20 px
for larger interface affordances with the same stroke style. Brand artwork and
specialized charts may use their own assets and documented semantic extensions.

Run the actual app build and the existing functional browser walkthrough and
`ui-quality-review` at desktop/mobile widths. Check keyboard/focus, responsive
layout, typography, actual rendered contrast, and relevant loading/empty/error
states. Structural integration and tested token contrast pairs are not proof
of whole-app WCAG compliance or visual quality. Fix shared defects in the
canonical foundation, not only the pilot fixture. This release starts as a
reference pilot; real generated-app acceptance is a separate delivery stage.
