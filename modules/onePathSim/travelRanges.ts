import { readTravelRangesForHouse } from "@/lib/usage/pastSimTravelRanges";

export async function getOnePathTravelRangesFromDb(
  userId: string,
  houseId: string
): Promise<Array<{ startDate: string; endDate: string }>> {
  return readTravelRangesForHouse({ userId, houseId });
}
