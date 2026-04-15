// src/core/polls/store_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { closeDb, initDb } from "@core/config/store.ts";
import {
	closePoll,
	createPoll,
	getPoll,
	getPollWithTally,
	getWinningOption,
	hasOpenPoll,
	toggleVote,
	updateMessageId,
} from "@core/polls/store.ts";

function mkSlots() {
	return [
		{ startDate: "25.04.2026", startTime: "19:00", endDate: "25.04.2026", endTime: "22:00" },
		{ startDate: "26.04.2026", startTime: "18:00", endDate: "26.04.2026", endTime: "21:00" },
		{ startDate: "27.04.2026", startTime: "14:00", endDate: "27.04.2026", endTime: "18:00" },
	];
}

Deno.test("createPoll + getPoll round trip", () => {
	initDb(":memory:");
	const { poll, options } = createPoll({
		chatId: "-1001",
		creatorUserId: "111",
		creatorDisplayName: "Alice",
		title: "Pizza night",
		slots: mkSlots(),
	});
	assertEquals(poll.status, "open");
	assertEquals(poll.title, "Pizza night");
	assertEquals(options.length, 3);
	const reloaded = getPoll(poll.id)!;
	assertEquals(reloaded.title, "Pizza night");
	assertEquals(reloaded.chatId, "-1001");
	closeDb();
});

Deno.test("toggleVote adds, re-toggles removes", () => {
	initDb(":memory:");
	const { poll, options } = createPoll({
		chatId: "-1002",
		creatorUserId: "111",
		creatorDisplayName: "Alice",
		title: "Meetup",
		slots: mkSlots(),
	});
	const firstOpt = options[0];
	assertEquals(
		toggleVote({
			pollId: poll.id,
			optionId: firstOpt.id,
			userId: "222",
			displayName: "Bob",
		}),
		"added",
	);
	const data1 = getPollWithTally(poll.id)!;
	assertEquals(data1.votesByOption.get(firstOpt.id)?.length, 1);

	assertEquals(
		toggleVote({
			pollId: poll.id,
			optionId: firstOpt.id,
			userId: "222",
			displayName: "Bob",
		}),
		"removed",
	);
	const data2 = getPollWithTally(poll.id)!;
	assertEquals(data2.votesByOption.get(firstOpt.id)?.length, 0);
	closeDb();
});

Deno.test("three voters + winner calculation", () => {
	initDb(":memory:");
	const { poll, options } = createPoll({
		chatId: "-1003",
		creatorUserId: "111",
		creatorDisplayName: "Alice",
		title: "Vote on this",
		slots: mkSlots(),
	});
	// Alice and Bob pick slot 0; Carol and Bob pick slot 1 → slot 1 wins (2 votes) over slot 0 (2 votes),
	// broken by earliest start → slot 0 wins (25.04 before 26.04).
	toggleVote({
		pollId: poll.id,
		optionId: options[0].id,
		userId: "111",
		displayName: "Alice",
	});
	toggleVote({
		pollId: poll.id,
		optionId: options[0].id,
		userId: "222",
		displayName: "Bob",
	});
	toggleVote({
		pollId: poll.id,
		optionId: options[1].id,
		userId: "222",
		displayName: "Bob",
	});
	toggleVote({
		pollId: poll.id,
		optionId: options[1].id,
		userId: "333",
		displayName: "Carol",
	});

	const data = getPollWithTally(poll.id)!;
	assertEquals(data.votesByOption.get(options[0].id)?.length, 2);
	assertEquals(data.votesByOption.get(options[1].id)?.length, 2);
	assertEquals(data.votesByOption.get(options[2].id)?.length, 0);

	const winner = getWinningOption(poll.id)!;
	// Tie broken by earliest start_date.
	assertEquals(winner.id, options[0].id);
	closeDb();
});

Deno.test("vote on closed poll is rejected", () => {
	initDb(":memory:");
	const { poll, options } = createPoll({
		chatId: "-1004",
		creatorUserId: "111",
		creatorDisplayName: "Alice",
		title: "Already closed",
		slots: mkSlots(),
	});
	closePoll(poll.id);
	const result = toggleVote({
		pollId: poll.id,
		optionId: options[0].id,
		userId: "222",
		displayName: "Bob",
	});
	assertEquals(result, "rejected");
	closeDb();
});

Deno.test("hasOpenPoll blocks concurrent polls per chat", () => {
	initDb(":memory:");
	const chatId = "-1005";
	assertEquals(hasOpenPoll(chatId), false);
	const { poll } = createPoll({
		chatId,
		creatorUserId: "111",
		creatorDisplayName: "Alice",
		title: "First",
		slots: mkSlots(),
	});
	assertEquals(hasOpenPoll(chatId), true);
	closePoll(poll.id);
	assertEquals(hasOpenPoll(chatId), false);
	closeDb();
});

Deno.test("updateMessageId persists", () => {
	initDb(":memory:");
	const { poll } = createPoll({
		chatId: "-1006",
		creatorUserId: "111",
		creatorDisplayName: "Alice",
		title: "MID test",
		slots: mkSlots(),
	});
	assertEquals(poll.messageId, null);
	updateMessageId(poll.id, 4242);
	const reloaded = getPoll(poll.id)!;
	assertEquals(reloaded.messageId, 4242);
	closeDb();
});

Deno.test("missing poll returns null", () => {
	initDb(":memory:");
	assert(getPoll("nonexistent") === null);
	assert(getPollWithTally("nonexistent") === null);
	closeDb();
});
