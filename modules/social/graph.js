"use strict";

/**
 * Relationship state machine. Backend is the source of truth.
 * Frontend only renders the returned `label` / `actions`.
 */

const LABELS = {
  SELF: "You",
  BLOCKED: "Blocked",
  FAMILY_MEMBER: "Family Member",
  FAMILY_PENDING: "Family Invite",
  FRIENDS: "Friends",
  PENDING_INCOMING: "Accept Request",
  PENDING_OUTGOING: "Request Sent",
  DECLINED: "Add Friend",
  NONE: "Add Friend"
};

function relationshipOf(DB, me, them, helpers) {
  helpers = helpers || {};
  const sharesFamily = helpers.sharesFamily || (() => false);
  if (!me || !them) {
    return pack("NONE", { actions: [] });
  }
  if (me === them) {
    return pack("SELF", { actions: ["my_qr", "share"] });
  }
  const blocked = (DB.blocks || []).some((x) =>
    (x.blockerId === me && x.blockedId === them) || (x.blockerId === them && x.blockedId === me)
  );
  const iBlocked = (DB.blocks || []).some((x) => x.blockerId === me && x.blockedId === them);
  if (blocked) {
    return pack("BLOCKED", {
      blocked: true,
      iBlocked,
      actions: iBlocked ? ["unblock", "report"] : ["report"]
    });
  }
  const family = typeof sharesFamily === "function" ? !!sharesFamily(me, them) : false;
  const famPending = (DB.joinRequests || []).find((r) =>
    r && r.status === "pending" && (
      (r.kind === "invite" && r.userId === me && familyMemberHint(DB, r.familyId, them)) ||
      (r.kind === "invite" && r.userId === them && r.fromId === me) ||
      (r.kind !== "invite" && r.userId === them && familyMemberHint(DB, r.familyId, me))
    )
  );
  const fr = (DB.friends || []).find((x) =>
    x && ((x.from === me && x.to === them) || (x.from === them && x.to === me))
  );
  if (family) {
    const actions = ["message", "invite_family"];
    if (fr && fr.status === "accepted") actions.push("remove_friend");
    else actions.push("add_friend");
    return pack("FAMILY_MEMBER", { family: true, friends: !!(fr && fr.status === "accepted"), requestId: fr && fr.id, actions: actions.concat(["block", "report", "share"]) });
  }
  if (famPending) {
    return pack("FAMILY_PENDING", {
      familyPending: true,
      requestId: famPending.id,
      actions: famPending.userId === me ? ["accept_family", "decline_family", "message", "block"] : ["message", "block", "report"]
    });
  }
  if (fr && fr.status === "accepted") {
    return pack("FRIENDS", {
      friends: true,
      requestId: fr.id,
      actions: ["message", "invite_family", "remove_friend", "block", "report", "share"]
    });
  }
  if (fr && fr.status === "pending" && fr.to === me) {
    return pack("PENDING_INCOMING", {
      requestId: fr.id,
      actions: ["accept_friend", "decline_friend", "message_request", "block", "report"]
    });
  }
  if (fr && fr.status === "pending" && fr.from === me) {
    return pack("PENDING_OUTGOING", {
      requestId: fr.id,
      actions: ["cancel_friend", "message_request", "block", "report"]
    });
  }
  if (fr && fr.status === "declined") {
    return pack("DECLINED", { requestId: fr.id, actions: ["add_friend", "message_request", "block", "report"] });
  }
  return pack("NONE", { actions: ["add_friend", "message_request", "invite_family", "block", "report", "share"] });
}

function familyMemberHint(DB, familyId, userId) {
  const f = (DB.families || []).find((x) => x.id === familyId);
  return !!(f && Array.isArray(f.members) && f.members.includes(userId));
}

function pack(state, extra) {
  extra = extra || {};
  return Object.assign({
    state,
    label: LABELS[state] || state,
    family: false,
    friends: false,
    blocked: false,
    requestId: null,
    actions: []
  }, extra);
}

function canDiscover(viewerId, user, channel, helpers) {
  helpers = helpers || {};
  const prefs = (helpers.userPrefs && helpers.userPrefs(user)) || {};
  const family = helpers.sharesFamily && helpers.sharesFamily(viewerId, user.id);
  const friends = helpers.areFriends && helpers.areFriends(viewerId, user.id);
  if (family || friends) return true;
  if (prefs.appearInSearch === false && channel === "name") return false;
  if (channel === "email") return String(prefs.findByEmail || "everyone") !== "nobody";
  if (channel === "phone") return String(prefs.findByPhone || "everyone") !== "nobody";
  const nameWho = String(prefs.findByName || "everyone");
  if (nameWho === "nobody") return false;
  if (nameWho === "friends") return !!friends;
  return true;
}

module.exports = { relationshipOf, canDiscover, LABELS };
