import { Paginated } from '../properties/property.models';

/** One public review (backend reviews/serializers.py:ReviewSerializer). */
export interface Review {
  id: number;
  rating: number; // 1-5
  comment: string; // may be ''
  author_name: string; // "Maria K." - never an email
  created_at: string; // ISO date-time
}

export interface RatingBreakdownRow {
  rating: number; // 5 down to 1
  count: number;
}

/** Over all of a property's visible reviews, not just the current page. */
export interface RatingSummary {
  rating_avg: number | null;
  review_count: number;
  breakdown: RatingBreakdownRow[];
}

/** GET /api/properties/{id}/reviews/ */
export interface ReviewPage extends Paginated<Review> {
  summary: RatingSummary;
}

/** The caller's own review, as embedded in a property or a booking (`my_review`). */
export interface MyReview {
  id: number;
  rating: number;
  comment: string;
  created_at: string;
}

/** `viewer_review` on the property detail: what the logged-in caller may do. */
export interface ViewerReview {
  can_review: boolean;
  my_review: MyReview | null;
}

/** POST /api/reviews/ body - the guest is always the logged-in user. */
export interface CreateReviewRequest {
  property: number;
  rating: number;
  comment: string;
}

/** Longest comment the API accepts (backend MAX_COMMENT_LENGTH). */
export const MAX_REVIEW_COMMENT = 1000;

/** Words shown under the star picker. */
export const RATING_WORDS: Record<number, string> = { 1: 'Terrible', 2: 'Poor', 3: 'Okay', 4: 'Good', 5: 'Excellent' };

/** Reviews shown per page under a property (backend ReviewPagination). */
export const REVIEWS_PAGE_SIZE = 5;
