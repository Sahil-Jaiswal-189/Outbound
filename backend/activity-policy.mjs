export const GOALS = {
  fitness: ["movement", "nature"], nature: ["nature", "curiosity"], calm: ["nature", "movement"],
  errands: ["errand"], home: ["errand"], social: ["social"], confidence: ["social"],
  creativity: ["creativity", "curiosity"]
};
export const HOBBIES = {
  walking: "movement", plants: "nature", photography: "creativity", reading: "creativity",
  music: "creativity", art: "creativity", food: "errand", sports: "movement"
};

// Transparent preference rules, not clinical claims or learned mood effects.
export function moodFit(quest, mood) {
  const gentle = ["none", "low"].includes(quest.physical_effort) && ["none", "low"].includes(quest.social_effort);
  if (["tired", "anxious"].includes(mood)) return gentle && ["nature", "movement", "creativity"].includes(quest.quest_type);
  if (mood === "restless") return quest.quest_type === "movement";
  if (["bored", "curious"].includes(mood)) return ["curiosity", "nature", "creativity"].includes(quest.quest_type);
  return false;
}

const shopping = new Set(["essential-top-up", "pantry-list-walk", "market-list", "price-compare", "refill-check"]);
export function intentReason(activityId, note = "") {
  if (shopping.has(activityId) && (/\b(no shopping|no purchases|don't buy|do not buy|avoid shopping|no spending)\b/i.test(note)
    || !/\b(buy|purchase|groceries|grocery|shopping list|milk|bread|fruit|vegetables|pantry)\b/i.test(note))) return "shopping_need_not_provided";
  if (activityId === "library-return" && (/\b(do not return|don't return|no book returns|not returning)\b/i.test(note)
    || !/\b(return|returning|drop off)\b/i.test(note) || !/\b(library|book|books)\b/i.test(note))) return "book_return_not_requested";
  return null;
}

export const NEEDS_DESTINATION = new Set(["park-lap", "nature-quiet-seat", "library-return", "recycling-drop", "letter-post",
  "donation-plan", "repair-shop-check", "shoe-repair-check", "home-measure-plan", "parcel-return-plan", "community-date-check"]);
