"use strict";

/** Message requests for people who are not friends or family. */

function ensure(DB) {
  DB.messageRequests = Array.isArray(DB.messageRequests) ? DB.messageRequests : [];
}

function pair(DB, a, b) {
  ensure(DB);
  return DB.messageRequests.find((x) =>
    x && ((x.from === a && x.to === b) || (x.from === b && x.to === a))
  ) || null;
}

function isOpen(row) {
  return !!(row && row.status === "accepted");
}

function serialize(row, me, getUser, publicUser) {
  const otherId = row.from === me ? row.to : row.from;
  const u = getUser(otherId);
  return {
    id: row.id,
    from: row.from,
    to: row.to,
    status: row.status,
    incoming: row.to === me && row.status === "pending",
    outgoing: row.from === me && row.status === "pending",
    createdAt: row.createdAt,
    preview: row.preview || "Message request",
    user: u ? publicUser(u, me, { forSearch: true }) : { id: otherId, name: "User" }
  };
}

module.exports = { ensure, pair, isOpen, serialize };
