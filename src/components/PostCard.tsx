import { Link } from 'react-router-dom';
import type { Post } from '../types';

interface PostCardProps {
  post: Post;
}

export default function PostCard({ post }: PostCardProps) {
  return (
    <article className="bg-white rounded-2xl border border-gray-100 hover:border-indigo-200 hover:shadow-lg transition-all duration-200 group overflow-hidden">
      <div className="p-6">
        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-3">
          {post.tags.map(tag => (
            <Link
              key={tag}
              to={`/tags/${encodeURIComponent(tag)}`}
              onClick={e => e.stopPropagation()}
              className="text-xs font-medium px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
            >
              {tag}
            </Link>
          ))}
        </div>

        {/* Title */}
        <Link to={`/post/${post.slug}`}>
          <h2 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-indigo-600 transition-colors line-clamp-2">
            {post.title}
          </h2>
        </Link>

        {/* Summary */}
        <p className="text-gray-500 text-sm leading-relaxed line-clamp-3 mb-4">
          {post.summary}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <time className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {post.date}
          </time>
          {post.readingTime && (
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              约 {post.readingTime} 分钟
            </span>
          )}
          <Link
            to={`/post/${post.slug}`}
            className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
          >
            阅读全文
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </article>
  );
}
