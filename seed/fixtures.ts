/**
 * Dev seed fixtures shared by `apps/auth_microservice/seed/seed.ts` and
 * `apps/core_microservice/seed/seed.ts`. Ids are fixed so both databases agree
 * on who is who and re-running the seed is idempotent.
 *
 * Follow graph (who → whom):
 *   alice ↔ bob        mutual
 *   carol → alice      one-way follower (alice does not follow back)
 *   alice → dave       one-way following (dave does not follow back)
 *   eve   → everyone   (except frank); nobody follows eve
 *   grace              popular: followed by everyone except frank
 *   heidi              follows people but has no posts
 *   frank              isolated: no follows, no posts
 */

export const SEED_PASSWORD = 'Password123!';
export const SEED_EMAIL_DOMAIN = 'innogram.dev';

const seedId = (kind: number, n: number) =>
  `5eed${kind.toString(16).padStart(4, '0')}-0000-4000-8000-${n
    .toString(16)
    .padStart(12, '0')}`;

export type Handle =
  | 'alice'
  | 'bob'
  | 'carol'
  | 'dave'
  | 'eve'
  | 'frank'
  | 'grace'
  | 'heidi';

export interface SeedUser {
  id: string;
  handle: Handle;
  email: string;
  displayName: string;
  bio: string | null;
}

const userRows: [Handle, string, string | null][] = [
  ['alice', 'Alice Novak', 'Illustrator. Coffee first, then pixels.'],
  ['bob', 'Bob Kowalski', 'Backend dev by day, bread baker by night.'],
  ['carol', 'Carol Smith', 'Trail runner and amateur birdwatcher.'],
  ['dave', 'Dave Miller', 'Photography, mostly of my cat.'],
  ['eve', 'Eve Adams', null],
  ['frank', 'Frank Lee', 'Just looking around.'],
  ['grace', 'Grace Hopper', 'Writing about tech, travel and food.'],
  ['heidi', 'Heidi Klein', 'Lurker. I read everything, post nothing.'],
];

export const users: SeedUser[] = userRows.map(
  ([handle, displayName, bio], i) => ({
    id: seedId(0, i + 1),
    handle,
    email: `${handle}@${SEED_EMAIL_DOMAIN}`,
    displayName,
    bio,
  }),
);

export const userId = (handle: Handle): string =>
  users.find((u) => u.handle === handle)!.id;

export const follows: [Handle, Handle][] = [
  ['alice', 'bob'],
  ['alice', 'dave'],
  ['alice', 'grace'],
  ['bob', 'alice'],
  ['bob', 'grace'],
  ['carol', 'alice'],
  ['carol', 'grace'],
  ['dave', 'grace'],
  ['eve', 'alice'],
  ['eve', 'bob'],
  ['eve', 'carol'],
  ['eve', 'dave'],
  ['eve', 'grace'],
  ['eve', 'heidi'],
  ['grace', 'bob'],
  ['heidi', 'alice'],
  ['heidi', 'bob'],
  ['heidi', 'grace'],
];

export type PostStatus = 'draft' | 'published' | 'archived';

export interface SeedPost {
  key: string;
  author: Handle;
  content: string;
  status: PostStatus;
  /** How long before the seed run the post was created. */
  hoursAgo: number;
}

export const posts: SeedPost[] = [
  { key: 'p1', author: 'alice', status: 'published', hoursAgo: 320, content: 'First post here! Testing out Innogram with a fresh sketchbook. ✏️' },
  { key: 'p2', author: 'alice', status: 'published', hoursAgo: 150, content: 'Finished the poster series for the local jazz festival. Three weeks of work.' },
  { key: 'p3', author: 'alice', status: 'published', hoursAgo: 6, content: 'Does anyone else redraw the same hand twenty times before it looks right?' },
  { key: 'p4', author: 'alice', status: 'draft', hoursAgo: 2, content: 'Draft: thoughts on switching from Procreate to Krita…' },
  { key: 'p5', author: 'bob', status: 'published', hoursAgo: 300, content: 'Sourdough attempt #14. The crumb is finally open!' },
  { key: 'p6', author: 'bob', status: 'published', hoursAgo: 200, content: 'Hot take: most microservices should have been a monolith.' },
  { key: 'p7', author: 'bob', status: 'published', hoursAgo: 30, content: 'Spent the whole day chasing a timezone bug. It was timestamptz all along.' },
  { key: 'p8', author: 'bob', status: 'draft', hoursAgo: 1, content: 'Draft: rye vs spelt comparison' },
  { key: 'p9', author: 'carol', status: 'published', hoursAgo: 280, content: 'Spotted a kingfisher on this morning\'s run. Ten seconds, no photo, worth it.' },
  { key: 'p10', author: 'carol', status: 'archived', hoursAgo: 260, content: 'Looking for a running buddy for the half marathon (archived, found one!).' },
  { key: 'p11', author: 'carol', status: 'published', hoursAgo: 48, content: '21 km done. Legs are jelly.' },
  { key: 'p12', author: 'dave', status: 'published', hoursAgo: 240, content: 'My cat discovered the radiator. Productivity is down 100%.' },
  { key: 'p13', author: 'dave', status: 'published', hoursAgo: 72, content: 'Golden hour on the old bridge. 35mm, no edits.' },
  { key: 'p14', author: 'dave', status: 'published', hoursAgo: 12, content: 'Film or digital? Asking for a friend (me).' },
  { key: 'p15', author: 'eve', status: 'published', hoursAgo: 100, content: 'Hello? Is this thing on?' },
  { key: 'p16', author: 'grace', status: 'published', hoursAgo: 310, content: 'Moved to Lisbon for a month. Ask me anything about remote work abroad.' },
  { key: 'p17', author: 'grace', status: 'published', hoursAgo: 180, content: 'Ranking every pastel de nata I ate this week. Long thread incoming.' },
  { key: 'p18', author: 'grace', status: 'published', hoursAgo: 96, content: 'The best debugging tool is still a good night\'s sleep.' },
  { key: 'p19', author: 'grace', status: 'published', hoursAgo: 24, content: 'What is one small habit that made you a better engineer? Replies welcome!' },
  { key: 'p20', author: 'grace', status: 'published', hoursAgo: 3, content: 'Back home. Jet lag is real, the coffee here is not as good.' },
];

export interface SeedComment {
  key: string;
  post: string;
  author: Handle;
  parent?: string;
  content: string;
  hoursAgo: number;
}

export const comments: SeedComment[] = [
  // p19 is the busy thread (many comments + replies).
  { key: 'c1', post: 'p19', author: 'alice', hoursAgo: 23, content: 'Writing down what I did at the end of every day.' },
  { key: 'c2', post: 'p19', author: 'bob', hoursAgo: 22, content: 'Reading the stack trace all the way to the bottom.' },
  { key: 'c3', post: 'p19', author: 'grace', parent: 'c2', hoursAgo: 21, content: 'The answer is always at the bottom. Always.' },
  { key: 'c4', post: 'p19', author: 'carol', hoursAgo: 20, content: 'Taking a walk when stuck. Works every time.' },
  { key: 'c5', post: 'p19', author: 'dave', hoursAgo: 19, content: 'Small commits.' },
  { key: 'c6', post: 'p19', author: 'eve', hoursAgo: 18, content: 'Asking questions earlier instead of struggling alone.' },
  { key: 'c7', post: 'p19', author: 'heidi', hoursAgo: 17, content: 'Reading other people\'s code reviews.' },
  { key: 'c8', post: 'p19', author: 'bob', parent: 'c7', hoursAgo: 16, content: 'Underrated. You learn so much from them.' },
  { key: 'c9', post: 'p19', author: 'alice', parent: 'c4', hoursAgo: 15, content: 'Same, half my ideas come on walks.' },
  { key: 'c10', post: 'p19', author: 'grace', hoursAgo: 14, content: 'Loving these, keep them coming!' },
  { key: 'c11', post: 'p19', author: 'carol', hoursAgo: 12, content: 'Writing tests before fixing a bug.' },
  { key: 'c12', post: 'p19', author: 'dave', parent: 'c11', hoursAgo: 10, content: 'This one saved me more than once.' },
  { key: 'c13', post: 'p19', author: 'eve', hoursAgo: 8, content: 'Turning off notifications while coding.' },
  { key: 'c14', post: 'p19', author: 'alice', hoursAgo: 5, content: 'Rubber duck debugging, literally with a duck.' },
  // Elsewhere.
  { key: 'c15', post: 'p3', author: 'bob', hoursAgo: 5, content: 'Every. Single. Time.' },
  { key: 'c16', post: 'p3', author: 'alice', parent: 'c15', hoursAgo: 4, content: 'Glad it\'s not just me 😅' },
  { key: 'c17', post: 'p3', author: 'carol', hoursAgo: 3, content: 'Hands and feet, the eternal enemies.' },
  { key: 'c18', post: 'p2', author: 'grace', hoursAgo: 140, content: 'These look amazing, congrats!' },
  { key: 'c19', post: 'p2', author: 'alice', parent: 'c18', hoursAgo: 139, content: 'Thank you! Come to the festival 🎷' },
  { key: 'c20', post: 'p6', author: 'grace', hoursAgo: 190, content: 'Strongly agree. Start with a modular monolith.' },
  { key: 'c21', post: 'p6', author: 'dave', hoursAgo: 185, content: 'Says the person working on microservices 😄' },
  { key: 'c22', post: 'p6', author: 'bob', parent: 'c21', hoursAgo: 184, content: 'I contain multitudes.' },
  { key: 'c23', post: 'p7', author: 'alice', hoursAgo: 28, content: 'It is always timezones.' },
  { key: 'c24', post: 'p12', author: 'eve', hoursAgo: 230, content: 'Cat tax paid, thank you.' },
  { key: 'c25', post: 'p13', author: 'alice', hoursAgo: 70, content: 'The light here is gorgeous.' },
  { key: 'c26', post: 'p13', author: 'dave', parent: 'c25', hoursAgo: 69, content: 'Got lucky with the clouds!' },
  { key: 'c27', post: 'p15', author: 'eve', hoursAgo: 99, content: 'Guess not…' },
  { key: 'c28', post: 'p17', author: 'bob', hoursAgo: 170, content: 'Need this ranking for my next trip.' },
  { key: 'c29', post: 'p11', author: 'grace', hoursAgo: 40, content: 'Congrats on finishing!' },
  { key: 'c30', post: 'p20', author: 'heidi', hoursAgo: 2, content: 'Welcome back!' },
];

/** Who liked which post. */
export const postLikes: [string, Handle[]][] = [
  ['p19', ['alice', 'bob', 'carol', 'dave', 'eve', 'heidi']],
  ['p2', ['bob', 'grace', 'eve']],
  ['p3', ['bob', 'carol']],
  ['p6', ['grace', 'heidi']],
  ['p13', ['alice', 'grace', 'eve']],
  ['p20', ['alice']],
];

/** Who liked which comment. */
export const commentLikes: [string, Handle[]][] = [
  ['c2', ['grace', 'alice', 'heidi']],
  ['c7', ['bob', 'grace']],
  ['c14', ['grace']],
  ['c20', ['bob']],
];

export const postId = (key: string): string =>
  seedId(1, posts.findIndex((p) => p.key === key) + 1);

export const commentId = (key: string): string =>
  seedId(2, comments.findIndex((c) => c.key === key) + 1);
