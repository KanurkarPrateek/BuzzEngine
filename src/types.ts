export type SourceName = "hn" | "github" | "reddit" | "x";

export type PostKind = "original" | "quote";

/** A single story/repo/post that could become a tweet. */
export type Candidate = {
  /** Stable identity within its source, e.g. "hn:38912345". */
  id: string;
  source: SourceName;
  title: string;
  /** The link we'd share. For HN "Ask HN" posts this is the discussion itself. */
  url: string;
  /** Where the conversation is happening, when different from `url`. */
  discussionUrl?: string;
  /** Free-text context handed to the model (repo description, post body, etc.). */
  summary?: string;
  /** Upvotes / stars-today / likes — whatever the source's engagement unit is. */
  engagement: number;
  comments: number;
  /** Epoch milliseconds. */
  createdAt: number;
  author?: string;
};

export type ScoredCandidate = Candidate & {
  score: number;
  velocity: number;
  topicFit: number;
  matchedTopics: string[];
};

export type Draft = {
  post: string;
  angle: string;
  confidence: number;
};

/** The editorial rubric, scored 1-10 per category. */
export type QualityScores = {
  understandable: number;
  funny: number;
  interesting: number;
  concise: number;
  human: number;
  accurate: number;
  memorable: number;
};

export type Verdict = {
  approved: boolean;
  reasons: string[];
  revised?: string;
  scores?: QualityScores;
};

export type HistoryEntry = {
  at: string;
  candidateId: string;
  source: SourceName;
  title: string;
  url: string;
  score: number;
  post: string;
  /** Original writing, or a quote post responding to someone else's tweet. */
  kind: PostKind;
  /** The tweet being quoted, when kind is "quote". */
  quotedTweetId?: string;
  /** Set when published via the X API. */
  tweetId?: string;
  /** Set when delivered for a human tap instead of auto-published. */
  intentUrl?: string;
  /** Set when queued through Buffer. */
  bufferPostId?: string;
  dryRun: boolean;
};
