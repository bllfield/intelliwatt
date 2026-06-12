import { readTravelRangesForHouse, resolveActiveTravelCoverageWindowForHouse } from "@/lib/usage/pastSimTravelRanges";

export async function getOnePathTravelRangesFromDb(
  userId: string,
  houseId: string
): Promise<Array<{ startDate: string; endDate: string }>> {
  const coverageWindow = resolveActiveTravelCoverageWindowForHouse({ userId, houseId });
  return readTravelRangesForHouse({ userId, houseId, coverageWindow });
}
