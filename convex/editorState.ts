import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Authorisation helper – only meeting participants may access */
async function assertCanAccess(
  ctx: any,
  meeting_id: string,
  userId: string
) {
  const interview = await ctx.db.get(meeting_id);
  if (!interview) throw new Error("Access denied");

  const isInterviewer = interview.interviewerIds.includes(userId);
  const isCandidate   =
    interview.candidateId
      ? interview.candidateId === userId          // normal case
      : true;                                    // slot still free ➜ allow

  if (!isInterviewer && !isCandidate) {
    throw new Error("Access denied");
  }
}

/* ------------------------------------------------------------------ */
/*  Latest state for a meeting                                         */
/* ------------------------------------------------------------------ */
export const getLatestState = query({
  args: { meeting_id: v.id("interviews") },
  handler: async (ctx, args) => {
    console.log("[editorState/getLatestState] called with", args);

    const identity = await ctx.auth.getUserIdentity();
    console.log("[editorState/getLatestState] identity", identity);

    if (!identity) throw new Error("Unauthenticated");
    await assertCanAccess(ctx, args.meeting_id, identity.subject);

    const snapshot = await ctx.db
      .query("editor_state")
      .withIndex("by_meeting_id", (q) => q.eq("meeting_id", args.meeting_id))
      .order("desc")
      .first();

    console.log("[editorState/getLatestState] returning snapshot", snapshot);
    return snapshot;
  },
});

/* ------------------------------------------------------------------ */
/*  Save a new snapshot – optimistic-concurrency via lastSeq         */
/* ------------------------------------------------------------------ */
export const saveState = mutation({
  args: {
    meeting_id: v.id("interviews"),
    content: v.string(),
    lastSeq: v.optional(v.number()), // client's latest known seq
  },
  handler: async (ctx, args) => {
    console.log("[editorState/saveState] called with", args);

    const identity = await ctx.auth.getUserIdentity();
    console.log("[editorState/saveState] identity", identity);

    if (!identity) throw new Error("Unauthenticated");
    await assertCanAccess(ctx, args.meeting_id, identity.subject);

    /* ────────────────────────────────────────────────────────────────
       If the candidate slot was empty, claim it with this user so
       future look-ups (e.g. dashboard filters) work.
    ───────────────────────────────────────────────────────────────── */
    const interviewDoc = await ctx.db.get(args.meeting_id);
    if (
      interviewDoc &&
      !interviewDoc.candidateId &&                        // slot still free
      !interviewDoc.interviewerIds.includes(identity.subject) // writer is not an interviewer
    ) {
      await ctx.db.patch(args.meeting_id, {
        candidateId: identity.subject,                    // claim the slot
      });
    }

    const latest = await ctx.db
      .query("editor_state")
      .withIndex("by_meeting_id", (q) => q.eq("meeting_id", args.meeting_id))
      .order("desc")
      .first();
    console.log("[editorState/saveState] latest snapshot", latest);

    if (
      args.lastSeq !== undefined &&
      latest &&
      latest.seq !== args.lastSeq
    ) {
      throw new Error("State is stale – fetch latest before updating");
    }

    const nextSeq = (latest?.seq ?? 0) + 1;
    console.log("[editorState/saveState] next sequence number", nextSeq);

    const id = await ctx.db.insert("editor_state", {
      meeting_id: args.meeting_id,
      seq: nextSeq,
      content: args.content,
      userId: identity.subject,
      createdAt: Date.now(),
    });
    console.log("[editorState/saveState] inserted doc id", id);

    const newDoc = await ctx.db.get(id);
    console.log("[editorState/saveState] returning", newDoc);
    return newDoc;
  },
});