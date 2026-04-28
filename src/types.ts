export interface Post {
  id: string;
  title: string;
  slug: string;
  date: string;
  summary: string;
  tags: string[];
  content: string;
  coverImage?: string;
  readingTime?: number;
}

export interface Tag {
  name: string;
  count: number;
}
