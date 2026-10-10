export const GOALS = {
  fitness: ["movement", "nature"], nature: ["nature", "curiosity"], calm: ["nature", "movement"],
  errands: ["errand"], home: ["errand"], social: ["social"], confidence: ["social"],
  creativity: ["creativity", "curiosity"]
};
export const HOBBIES = {
  walking: "movement", plants: "nature", photography: "creativity", reading: "creativity",
  music: "creativity", art: "creativity", food: "errand", sports: "movement"
};

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
