---
name: Architecture Explorer
colors:
  canvas: '#090d16'
  surface-1: '#0f172a'
  surface-2: '#1e293b'
  surface-interactive: '#243247'
  border-muted: '#1e293b'
  border-strong: '#334155'
  border-focus: '#06b6d4'
  primary: '#06b6d4'      # active node / live state
  secondary: '#6366f1'    # transitions / pipeline
  tertiary: '#8b5cf6'     # terminal / external / cached
  gradient: 'linear-gradient(135deg, #06b6d4 0%, #6366f1 50%, #8b5cf6 100%)'
  error: '#ef4444'
  error-text: '#f87171'
  text-high: '#f8fafc'
  text-secondary: '#cbd5e1'
  text-muted: '#94a3b8'
  text-subtle: '#475569'
  accent-wash: 'rgba(6, 182, 212, 0.10)'
  active-code-line: 'rgba(6, 182, 212, 0.08)'
  grid-line: 'rgba(51, 65, 85, 0.25)'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '600'
    lineHeight: 56px
    letterSpacing: -0.03em
  display-lg-mobile:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-xl:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.025em
  headline-xl-mobile:
    fontFamily: Geist
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '500'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  code-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 22px
    letterSpacing: -0.01em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 0.75rem
  margin: 2rem
  margin-mobile: 1rem
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
  space-3xl: 3rem
---

## Brand & Style

This design system models complex architectural knowledge as an interactive visual essay. It merges the mechanical precision of developer mission control with the intuitive pedagogy of explorable technical explanations. The interface treats software systems not as static reference manuals, but as navigable machines: dynamic metro-map dependency graphs, memory-mapped component views, and structured execution traces.

The aesthetic philosophy balances disciplined minimalism with luminous, data-driven focal points:
- **Atmospheric Grounding:** A deep, noise-free slate canvas provides contrast without harsh pitch-black extremes, reducing eye fatigue during deep architectural reviews.
- **Architectural Clarity:** Layouts utilize structural grid alignments, sub-pixel borders, and monospaced data grids to project rigor, predictability, and mechanical integrity.
- **Luminous Intent:** Color is strictly semantic. Kinetic cyan-to-violet gradients denote state flow, active execution nodes, and user traversal paths rather than decorative distraction.

## Colors

The palette utilizes deeply saturated, cool slate tones for structural foundations, paired with an electric spectrum (cyan through indigo and violet) reserved strictly for interactive state, active metro-map nodes, and execution paths.

### Surface Tiers
- **Canvas Base (`#090d16`):** The foundational substrate for entire viewports, background viewports, and graph canvasses.
- **Surface Elevation 1 (`#0f172a`):** Primary structural panels, sidebars, inspection drawers, and code cards.
- **Surface Elevation 2 (`#1e293b`):** Popovers, active code inspector overlays, tooltips, and elevated control groups.
- **Surface Elevated Interactive (`#243247`):** Hover and pressed states for panels and list nodes.

### Structural Outlines
- **Muted Border (`#1e293b`):** Primary demarcation between views, panels, and layout columns.
- **Active / Accent Border (`#334155`):** Secondary dividers, inactive input outlines, and component bounding frames.
- **Focus Border (`#06b6d4`):** Keyboard navigation focus rings, highlighted nodes, and selection boundaries.

### Semantic Accents & Gradient Matrix
- **Primary Cyan (`#06b6d4`):** Current active node, live execution trace, primary actions, and interactive query highlights.
- **Secondary Indigo (`#6366f1`):** Intermediate dependency transitions, active pipeline segments, and secondary telemetry tags.
- **Tertiary Violet (`#8b5cf6`):** Terminal nodes, external network egress, and historical or cached state.
- **Gradient Vector (`linear-gradient(135deg, #06b6d4 0%, #6366f1 50%, #8b5cf6 100%)`): Reserved strictly for live processing states, active metro-map path traversal, and interactive completion bars.

### Typography & Content
- **Text High-Contrast (`#f8fafc`):** Primary headlines, active code lines, and focal metrics.
- **Text Secondary (`#cbd5e1`):** Explanatory prose, documentation paragraphs, and active parameters.
- **Text Muted (`#94a3b8`):** File metadata, node coordinates, non-focused code syntax, and path breadcrumbs.
- **Text Subtle (`#475569`):** Disabled controls, grid labels, and line numbers.

## Typography

Typography establishes an intentional division between structural narrative, explanatory documentation, and technical artifacts:

- **Geist (Display & Headlines):** Crisp geometric sans-serif engineered for technical displays. Delivers high optical precision at scale, giving graph panels and essay headers an engineered finish.
- **Inter (Explanatory Body):** Utilitarian, neutral workhorse optimized for long-form architectural breakdowns, system design rationale, and conceptual documentation.
- **JetBrains Mono (Technical Identifiers & Code):** Carries code blocks, file paths, call-stack telemetry, node metadata, and micro-labels. Tabular figures must be enabled by default (`tnum`) across all monospaced elements for strict visual column alignment in callouts and metrics.

### Formatting Guidelines
- Set all `label-caps` in uppercase with letter-spacing for system status badges, table headers, and graph coordinates.
- Ensure inline code phrases within `body-md` maintain identical baseline alignment using `code-md` styling, accompanied by a subtle `#1e293b` background pill with 2px horizontal padding.

## Layout & Spacing

The layout is built as a mission-control console: modular, responsive, and oriented around simultaneous visual exploration and deep inspection.

### Layout Model
- **Workbench Canvas (Desktop):** A 3-zone layout consisting of a collapsible Navigation Index (260px fixed width), a dynamic Metro Graph / Architecture Visualizer (fluid, central workspace), and an Explorable Documentation Inspector (440px fixed or expandable pane).
- **Responsive Adaptations:**
  - **Desktop (>= 1280px):** Full 3-pane workbench active simultaneously with fluid center graph pane.
  - **Tablet (768px - 1279px):** Navigation transitions to a drawer overlay; screen divides 50/50 between the visual graph and the contextual documentation panel.
  - **Mobile (< 768px):** Stacked single-pane layout with segmented tab switching (`Visual Graph`, `Docs & Spec`, `Metrics`). Outer margins step down to `margin-mobile` (16px), and gutters to `gutter-mobile` (12px).

### Spacing Rules
- Use `space-2xs` (2px) and `space-xs` (4px) strictly for internal badge padding, button icon gaps, and tight data-grid borders.
- Component-level internal padding utilizes `space-md` (12px) for compact toolbars and `space-xl` (24px) for architectural documentation cards.
- Layout sections maintain minimum vertical clearances of `space-2xl` (32px) to prevent density overload.

## Elevation & Depth

Visual hierarchy uses flat, high-contrast, sub-pixel outlines combined with deep tonal surfaces rather than heavy blurred drop-shadows. This preserves crispness on high-density displays.

### Elevation Hierarchy
- **Level 0 (Canvas Base):** Surface `#090d16`. Static grid lines rendered with `rgba(51, 65, 85, 0.25)` on 24px pitch.
- **Level 1 (Docked Containers & Nodes):** Surface `#0f172a`, bounded by a single 1px solid border of `#1e293b`. No box shadow.
- **Level 2 (Active Inspection Panels & Selected Nodes):** Surface `#1e293b`, 1px solid border of `#334155`. Ambient shadow: `0 4px 20px -2px rgba(2, 6, 23, 0.6)`.
- **Level 3 (Command Palettes, Overlays, Active Metro Nodes):** Surface `#0f172a` with a 1px border of `#06b6d4`. Ambient bloom: `0 0 16px -2px rgba(6, 182, 212, 0.25), 0 12px 32px -4px rgba(2, 6, 23, 0.8)`.

### Optical Highlights & Glass Details
- Modals and transient inspection flyouts use `backdrop-filter: blur(12px)` over `#090d16`/85% opacity to maintain graph location context while focusing on technical specifications.
- Interactive graph nodes feature a 1px inner hairline stroke (`inset 0 1px 0 0 rgba(255, 255, 255, 0.06)`) to catch virtual light at the top edge.

## Shapes

The design system enforces a disciplined `roundedness: 1` (Soft) profile, yielding tight 4px (`0.25rem`) corners on base UI components. This gives the application an instrument-grade, hardware-inspired character.

### Radii Token Mapping
- **Default Base (`rounded`, 4px):** Code blocks, action buttons, filter chips, input fields, and metro-map entity nodes.
- **Medium Panels (`rounded-lg`, 8px):** Architectural overview cards, inspector drawers, modal sheets, and floating toolbars.
- **Large Overlays (`rounded-xl`, 12px):** Top-level system architecture maps and mission-control viewport containers.
- **Pill (`rounded-full`, 9999px):** Status indicator dots, active execution pulse markers, and numeric graph badges.

## Components

### Buttons & Interactive Triggers
- **Primary Action:** Solid cyan-to-violet gradient background, text `#090d16` (bold for contrast), 4px border radius. Hover state increases brightness by 10% and adds a subtle cyan glow (`0 0 12px rgba(6, 182, 212, 0.4)`).
- **Secondary / Ghost:** Surface transparent, 1px solid `#334155`, text `#f8fafc`. Hover triggers background `#1e293b` and border `#06b6d4`.
- **Icon / Control Rail:** 32x32px square buttons with 4px border radius. Inactive icons set to `#94a3b8`, illuminating to `#06b6d4` on hover or active state.

### Chips & Badges
- **Architecture Tag:** `#0f172a` background, 1px solid `#1e293b`, text `#94a3b8`, `JetBrains Mono` 11px font.
- **Active State Node Tag:** `#06b6d4`/10% background, 1px solid `#06b6d4`, text `#06b6d4` with a 6px circular glowing pulsing indicator.
- **Warning / Fault Tag:** `#ef4444`/10% background, 1px solid `#ef4444`, text `#f87171`.

### Interactive Metro-Map Nodes (Custom)
- **Node Shell:** Multi-layered SVG elements with `#0f172a` body, 1.5px stroke using `#334155`.
- **Active Node:** Stroke shifts to `#06b6d4`, fill gradient subtly incorporates `#06b6d4`/15% to `#6366f1`/15%.
- **Connecting Tracks (Edges):** 2px stroke `#1e293b`. When hovered or actively tracing execution, track animates using an SVG dash-array glow with the cyan-to-violet gradient.

### Code Blocks & Inspector Panels
- **Code Container:** Surface `#0a0f1d`, 1px solid border `#1e293b`, 4px border radius.
- **Header Strip:** 32px height, border-bottom 1px solid `#1e293b`, background `#0f172a`. Contains file path in `code-sm` with text `#94a3b8`, alongside copy/pin action icons.
- **Line Numbers:** Right-aligned, width 32px, text `#475569`, border-right 1px solid `#1e293b`/50%.
- **Active Code Line:** Background `#06b6d4`/8%, left border highlight 2px solid `#06b6d4`.

### Input & Query Fields
- **Search & Architecture Query Bar:** Height 40px, surface `#0f172a`, border 1px solid `#334155`, text `#f8fafc`.
- **Focus State:** 1px solid border `#06b6d4`, accompanied by an instant 2px outer ring `rgba(6, 182, 212, 0.2)`. Placeholder text in `#475569`. Integrated keyboard shortcut prompt (`⌘K`) in `label-caps` on the trailing edge.

### Cards & Explorable Modules
- **Modular Explorable Card:** 8px border radius, background `#0f172a`, 1px solid `#1e293b`.
- **Card Interactive State:** On hover, border color transitions to `#334155` over 150ms. If the card controls an active graph viewport, the top border activates with a 2px gradient line (`#06b6d4` to `#6366f1`).