

# Add Citation History Panel to Left Sidebar

## Overview
Add a left-side panel that displays the user's citation history for the current project, alongside the main input area. This creates a three-column layout: projects sidebar (right) | main content (center) | citation history (left).

## Layout

```text
┌──────────────────────────────────────────────────┐
│                    Header                         │
├──────────┬─────────────────────┬─────────────────┤
│ Projects │   Main Content      │ Citation History │
│ (right)  │   (center)          │ (left)           │
│  w-52    │   flex-1            │  w-64            │
│          │                     │                  │
│          │   [input bar]       │  search filter   │
│          │                     │  citation list   │
└──────────┴─────────────────────┴─────────────────┘
```

## Changes

### 1. Create `src/components/CitationHistorySidebar.tsx`
- New component that fetches `citation_history` for the current user + project
- Displays a scrollable list of past citations, newest first
- Each item shows: truncated raw input, formatted output, source type badge, timestamp
- Search/filter input at the top
- Click on a citation copies it or inserts it into the input field
- Realtime or refetch on new citation creation
- Desktop only (hidden on mobile, or accessible via a toggle)

### 2. Modify `src/pages/Index.tsx`
- Add the `CitationHistorySidebar` as a left panel inside the `flex` layout (line ~823)
- Place it after the main column div, so in RTL it appears on the left side
- Only show for authenticated (non-guest) users on desktop
- Pass `currentProject?.id` and a callback for when a citation is clicked

### 3. Mobile handling
- Hide the history panel on mobile (`hidden md:flex`)
- Optionally add a toggle button in the header to show it as a drawer (similar to the existing mobile sidebar pattern)

## Technical Details
- Query: `supabase.from("citation_history").select("*").eq("user_id", user.id).eq("project_id", projectId).order("created_at", { ascending: false }).limit(50)`
- Filter locally by search text matching `raw_input` or `formatted_output`
- Use `useEffect` to refetch when `projectId` changes
- Clicking a citation item copies `formatted_output` to clipboard with a toast confirmation

