# Feature Specification: Post Feed

**Feature Branch**: `002-post-feed`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Create feed page layout with post display; Implement post creation interface with file upload; Add post editing and deletion functionality; Create post interaction buttons (like, comment, share); Add file upload interface for images/videos; Implement post media display and gallery; Add post sorting and filtering options; Create post search interface."

## Clarifications

### Session 2026-09-28

- Q: Is a fully functional like/unlike interaction in scope (including any backend support required), or should the like button be visual-only for now? → A: Full like/unlike interaction in scope, including any backend support required.
- Q: What should the "share" action do? → A: Both — copy a link / invoke the native share sheet, and re-post the content to the user's own feed (in-app re-post with attribution to the original author).
- Q: Should the feed show posts from accounts the user follows (plus their own), or all public posts across the platform? → A: Both — a "Following" feed (followed accounts plus own posts) and a separate "Discover" feed (all public posts across the platform).
- Q: Should posts support "save as draft" and "archive", or just create-then-publish with edit/delete? → A: Full lifecycle — save as draft, publish, archive, and delete.
- Q: What sort options and filter attributes should the feed offer? → A: Sort by newest / oldest / most-liked; filter by media type (photos / videos / text-only).
- Q: When a user deletes a post, what should happen to its comments, likes, and re-posts? → A: The post and its comments/likes disappear from view everywhere; any re-posts show a "post unavailable" placeholder.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View the post feed (Priority: P1)

A signed-in user opens the Home/Feed section and sees a scrollable feed of posts ordered newest-first. The default "Following" feed shows published posts from accounts the user follows plus the user's own posts; a separate "Discover" feed shows all public posts across the platform. Each post shows the author, the post text, any attached media, and its engagement state (likes and comment count). The user can switch between the two feeds and continue scrolling to load more posts.

**Why this priority**: The feed is the core surface of the social experience. Without a rendered, populated feed, none of the other post capabilities (create, interact, search) have a place to live.

**Independent Test**: Can be fully tested by signing in, opening the Home/Feed section, switching between the Following and Discover feeds, and confirming posts render with author, text, media, and engagement information, and that additional posts load as the user scrolls.

**Acceptance Scenarios**:

1. **Given** a signed-in user and existing posts, **When** the user opens the Feed section, **Then** the Following feed is shown by default, displaying the user's own posts and posts from followed accounts, newest-first, each showing author, text, and media.
2. **Given** a signed-in user, **When** the user switches to the Discover feed, **Then** all public posts across the platform are shown, newest-first.
3. **Given** more posts than fit on one screen, **When** the user scrolls to the bottom of either feed, **Then** the next page of posts loads without a full-page reload.
4. **Given** the feed cannot be loaded (e.g., a service is unavailable), **When** the user opens the Feed section, **Then** a friendly error/retry state is shown and the app recovers once the service is available again.

---

### User Story 2 - Create and publish a post with media (Priority: P1)

A signed-in user composes a new post by entering text and optionally attaching one or more images or videos, then either publishes it immediately or saves it as a draft to finish later. Once published, the post appears in the feeds for themselves and other users to see.

**Why this priority**: Post creation is the primary act of content generation and the reason the feed exists. Combined with the feed (Story 1), it forms the minimal usable product.

**Independent Test**: Can be fully tested by signing in, opening the compose interface, entering text, attaching an image or video, publishing, and confirming the post appears in the feed with its media.

**Acceptance Scenarios**:

1. **Given** a signed-in user on the compose interface, **When** the user enters text and publishes, **Then** a new post is created and appears in the feed.
2. **Given** a signed-in user composing a post, **When** the user attaches an image or video and publishes, **Then** the media is uploaded and displayed as part of the published post.
3. **Given** a user attempts to publish an empty post (no text and no media), **When** they press publish, **Then** they are prevented from publishing with a clear message.
4. **Given** a user attaches an unsupported or oversized file, **When** they attempt to upload it, **Then** they are shown a clear, friendly error and the post is not created.
5. **Given** a signed-in user composing a post, **When** the user saves the post as a draft without publishing, **Then** the post is saved as a draft and does not appear in feeds until published.

---

### User Story 3 - Interact with posts: like, comment, share (Priority: P2)

A signed-in user engages with posts by liking/unliking them, writing and reading comments, and sharing a post with others. Engagement state (liked/not-liked, comment count) is reflected in the interface and stays consistent for the user.

**Why this priority**: Interaction turns a read-only feed into a social experience. It is prioritized after create/read because it is additive value on top of the core feed.

**Independent Test**: Can be fully tested by liking and unliking a post, posting a comment and viewing existing comments, and using the share action on a post.

**Acceptance Scenarios**:

1. **Given** a signed-in user viewing a post, **When** the user selects "like", **Then** the post is marked liked and the like state is reflected; selecting it again unlikes the post.
2. **Given** a signed-in user viewing a post, **When** the user writes and submits a comment, **Then** the comment appears with the post and other users can see it.
3. **Given** a signed-in user viewing a post, **When** the user selects "share" and chooses "copy link" or the native share sheet, **Then** the post link is copied or shared externally as intended.
4. **Given** a signed-in user viewing a post, **When** the user selects "re-post", **Then** the post is shared to their own feed and appears there with attribution to the original author.
5. **Given** a signed-in user viewing a post with existing comments, **When** the user opens the comments, **Then** the existing comments are displayed.

---

### User Story 4 - Edit, archive, and delete own posts (Priority: P2)

A signed-in user can edit the text and media of a post they authored, archive a published post to hide it from feeds, and delete their own posts. They cannot edit, archive, or delete posts authored by other users.

**Why this priority**: Ownership controls are essential to trust in the platform and are a natural companion to post creation. This is prioritized after creation because it is a refinement of the create flow.

**Independent Test**: Can be fully tested by editing the text/media of one's own post and confirming the change persists, archiving a published post and confirming it is hidden from feeds, deleting one's own post and confirming it is removed, and confirming these actions are not available on another user's post.

**Acceptance Scenarios**:

1. **Given** a signed-in user viewing a post they authored, **When** the user edits the text and saves, **Then** the updated text is displayed and persisted.
2. **Given** a signed-in user viewing a post they authored, **When** the user deletes the post, **Then** the post and its comments and likes are no longer shown to any user, and any re-posts of it show a "post unavailable" placeholder.
3. **Given** a signed-in user viewing another user's post, **When** they inspect available actions, **Then** edit, archive, and delete are not offered.
4. **Given** a signed-in user attempting to delete a post, **When** they trigger delete, **Then** they are asked to confirm before the post is permanently removed.
5. **Given** a signed-in user viewing a published post they authored, **When** the user archives the post, **Then** the post is hidden from feeds but retained for the author.

---

### User Story 5 - View post media in a gallery/lightbox (Priority: P2)

When a post contains one or more images or videos, the user can view them in place and open them into a full-screen gallery (lightbox) to see them enlarged, with controls to navigate between media items and play videos.

**Why this priority**: Media viewing is core to a media-rich feed. It is separated from basic feed display so it can be refined (full-screen, navigation, video playback) independently.

**Independent Test**: Can be fully tested by opening a post with multiple images/videos, opening the gallery, navigating between items, and playing a video.

**Acceptance Scenarios**:

1. **Given** a post with one or more images, **When** the user selects an image, **Then** it opens enlarged in a full-screen view.
2. **Given** a post with multiple media items, **When** the user is in the gallery, **Then** they can navigate forward and backward between items.
3. **Given** a post containing a video, **When** the user opens and plays the video, **Then** the video plays in the gallery with standard playback controls.
4. **Given** a post with no media (text-only), **When** displayed in the feed, **Then** it renders cleanly without media placeholders.

---

### User Story 6 - Sort and filter the feed (Priority: P3)

A signed-in user can change the order of the feed and filter which posts are shown, so they can focus on the content most relevant to them.

**Why this priority**: Sorting and filtering are refinement features that improve the browsing experience but are not required for the core create/read/interact loop.

**Independent Test**: Can be fully tested by changing the sort order and applying a filter and confirming the feed updates to reflect the selected options.

**Acceptance Scenarios**:

1. **Given** a signed-in user on the feed, **When** the user selects a sort option (newest, oldest, or most-liked), **Then** the feed reorders to reflect the selected option.
2. **Given** a signed-in user on the feed, **When** the user applies a media-type filter (photos, videos, or text-only), **Then** only posts matching the filter are shown.
3. **Given** a signed-in user has applied a sort or filter, **When** they clear the selection, **Then** the feed returns to its default order and full content.

---

### User Story 7 - Search for posts (Priority: P3)

A signed-in user can search for posts by entering a keyword, and is shown matching posts. The search is reachable from a dedicated search interface.

**Why this priority**: Search is a discovery feature that is valuable but not essential to the core feed experience, so it is prioritized last.

**Independent Test**: Can be fully tested by entering a search term and confirming matching posts are returned and displayed, and that an empty or no-match query produces an appropriate result.

**Acceptance Scenarios**:

1. **Given** a signed-in user on the search interface, **When** the user enters a keyword and submits, **Then** posts matching the keyword are displayed.
2. **Given** a signed-in user enters a keyword with no matching posts, **When** they submit, **Then** a friendly "no results" state is shown.
3. **Given** a signed-in user enters a keyword shorter than the minimum search length, **When** they attempt to search, **Then** they are prompted to enter a longer term.

---

### Edge Cases

- What happens when a post's media fails to load (broken or slow asset)? A placeholder or error is shown for that media item without breaking the rest of the post or feed.
- What happens when a user uploads a file that is too large or of an unsupported type? The upload is rejected with a clear, friendly message before the post is published.
- What happens when the user tries to publish a post with no text and no media? The publish action is blocked with a clear message.
- What happens when two users interact with the same post concurrently (e.g., simultaneous likes or comments)? Each interaction is applied consistently and the visible counts remain correct.
- What happens when a user attempts to edit or delete a post they do not own? The action is not offered, and any direct attempt is denied without affecting the post.
- What happens when a user attempts to delete a post and then cancels the confirmation? The post remains unchanged.
- What happens when a post has more media items than can be shown in a single view? The gallery provides navigation, and any limit is communicated clearly.
- What happens during search with a very large number of matches? Results are paginated and load progressively.
- What happens to comments, likes, and re-posts when a post is deleted? The post and its comments/likes disappear from view everywhere, and any re-posts show a "post unavailable" placeholder.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display a feed of posts, ordered newest-first by default, each showing author, text content, attached media, and engagement summary (like state and comment count).
- **FR-002**: The system MUST paginate the feed so users can load additional posts progressively while scrolling, without a full-page reload.
- **FR-003**: The system MUST display a friendly error/retry state when the feed cannot be loaded and recover automatically once it becomes available.
- **FR-004**: The system MUST allow a signed-in user to create a post consisting of text and, optionally, one or more attached images or videos.
- **FR-005**: The system MUST allow a signed-in user to upload image and video files as attachments to a post, with an upload interface that reports progress and errors.
- **FR-006**: The system MUST reject invalid or oversized uploads with a clear, friendly message and MUST NOT create a post with invalid media.
- **FR-007**: The system MUST prevent publishing a post that has no text and no media.
- **FR-008**: The system MUST allow a signed-in user to edit the text and media of a post they authored.
- **FR-009**: The system MUST allow a signed-in user to delete a post they authored, and MUST require confirmation before deletion.
- **FR-010**: The system MUST NOT allow a user to edit, archive, or delete a post authored by another user.
- **FR-011**: The system MUST allow a signed-in user to like and unlike a post and reflect the like state consistently, delivered end-to-end including any backend support required.
- **FR-012**: The system MUST allow a signed-in user to view, add, edit, and delete comments on a post, and MUST display existing comments.
- **FR-013**: The system MUST allow a signed-in user to share a post by copying a link to it and by invoking the device's native/browser share sheet.
- **FR-014**: The system MUST allow a signed-in user to re-post (share) a post to their own feed, where it appears with attribution to the original author.
- **FR-015**: The system MUST display post media (images and videos) inline in the feed and open media into a full-screen gallery with navigation between items and video playback controls.
- **FR-016**: The system MUST render text-only posts cleanly, without media placeholders.
- **FR-017**: The system MUST allow a signed-in user to sort the feed by newest, oldest, and most-liked, with newest-first as the default.
- **FR-018**: The system MUST allow a signed-in user to filter the feed by media type (photos, videos, or text-only) and MUST clearly communicate when a filter is active.
- **FR-019**: The system MUST allow a signed-in user to clear any applied sort or filter and return to the default feed.
- **FR-020**: The system MUST provide a search interface that returns posts matching a user-entered keyword.
- **FR-021**: The system MUST display a friendly "no results" state when a search returns no matches.
- **FR-022**: The system MUST enforce a minimum search term length and prompt the user when the term is too short.
- **FR-023**: The system MUST provide two feed views — a "Following" feed showing published posts from accounts the user follows plus the user's own posts, and a "Discover" feed showing all public posts across the platform — and MUST allow the user to switch between them.
- **FR-024**: The system MUST allow a signed-in user to save a post as a draft, composing text and media and saving without publishing.
- **FR-025**: The system MUST allow a signed-in user to publish a draft post, after which it appears in feeds.
- **FR-026**: The system MUST allow a signed-in user to archive a published post, removing it from feeds while retaining it for the author.
- **FR-027**: The system MUST, when a post is deleted, hide the post and its comments and likes from view everywhere, and display a "post unavailable" placeholder for any re-posts of the deleted post.

### Key Entities *(include if feature involves data)*

- **Post**: The central content unit. Has an author, text content, a lifecycle status (e.g., draft, published, archived), one or more attached media items, and engagement data (likes, comments). Created and owned by a single user.
- **Media Asset**: An image or video attached to a post, displayed in a defined order. Has a type (image/video) and is associated with its owning post.
- **Comment**: A text response authored by a user and attached to a specific post.
- **Like/Reaction**: A user's expression of approval on a post, tracked so the interface can reflect whether the current user has liked a post.
- **Repost/Share**: A user's re-posting of an existing post to their own feed, retaining attribution to the original author; distinct from the simple copy-link/native share action.
- **User (Author)**: The signed-in user who authors a post or comment; referenced from the existing user/profile identity rather than redefined by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in user can view the feed and see posts (with author, text, and media) within 3 seconds of opening the Feed section on a standard broadband connection.
- **SC-002**: 100% of posts created with valid input (text and/or valid media) are published and appear in the feed.
- **SC-003**: A signed-in user can complete the full create-and-publish flow (compose, attach media, publish) in under 2 minutes.
- **SC-004**: 100% of like and unlike actions result in the correct, consistent engagement state for the user.
- **SC-005**: A signed-in user can edit, archive, and delete only their own posts; 0% of attempts to edit, archive, or delete another user's post succeed.
- **SC-006**: 100% of attached images and videos render correctly in the feed and open in the gallery with working navigation and playback.
- **SC-007**: Applying a sort or filter updates the displayed feed to match the selection in under 2 seconds, and clearing it restores the default view.
- **SC-008**: 95% of search queries return matching results, and a "no results" state is shown when there are no matches.
- **SC-009**: The interface remains usable and navigable across desktop, tablet, and mobile viewport sizes.
- **SC-010**: A signed-in user can share a post by copying its link or using the native share sheet, and can re-post it so it appears in their feed with attribution to the original author.
- **SC-011**: A signed-in user can switch between the Following and Discover feeds, and both display posts newest-first with working pagination.
- **SC-012**: A signed-in user can save a post as a draft, publish it later, and archive a published post, with each state reflected correctly in the interface.

## Assumptions

- This feature builds on the client application baseline (navigation shell, login/JWT authentication, and end-to-end connectivity established in `001-client-app-baseline`) and does not re-establish those foundations.
- The backend already exposes post creation, the follow-based feed, search, update, publish/archive, and deletion, as well as comment and asset-upload capabilities; the client consumes these existing capabilities rather than reimplementing them.
- "Like", "re-post", the "Discover" (global public) feed, and engagement counts (like and comment counts shown on each post) require backend capabilities that do not currently exist; these are delivered as part of this feature (backend support plus the client interface).
- Post text has a maximum length of 500 characters, each post can attach up to 10 media items, and each uploaded file is limited to 10 MB; these limits are surfaced to the user in the interface.
- Sorting and filtering of the feed operate over the posts loaded for the user; the default order is newest-first. Sorting by "most-liked" depends on like counts, which are delivered as part of the like backend support.
- "Share" means both copying a link / invoking the device's native share sheet and re-posting the content to the user's own feed with attribution to the original author.
- File uploads are limited to images and videos up to 10 MB each; the interface communicates these constraints and rejects invalid uploads before publishing.
- Published posts are publicly visible platform-wide (any signed-in user can view them via search and the Discover feed); there are no per-post visibility or privacy controls in this feature.
- The client never imports backend-only shared code and depends only on consumer-safe shared contracts, consistent with existing project boundaries.
