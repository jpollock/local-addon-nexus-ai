/**
 * Site Group Types (Sprint 3)
 */

export interface SiteGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  siteIds: string[];
  isDynamic: boolean;
  createdAt: number;
  updatedAt: number;
}
