import { Link, useParams } from 'react-router-dom';
import { getAllTags, getPostsByTag } from '../data';
import PostCard from '../components/PostCard';

export default function TagsPage() {
  const { tag } = useParams<{ tag?: string }>();
  const allTags = getAllTags();

  const colors = [
    'bg-blue-50 text-blue-600 hover:bg-blue-100',
    'bg-purple-50 text-purple-600 hover:bg-purple-100',
    'bg-green-50 text-green-600 hover:bg-green-100',
    'bg-orange-50 text-orange-600 hover:bg-orange-100',
    'bg-pink-50 text-pink-600 hover:bg-pink-100',
    'bg-cyan-50 text-cyan-600 hover:bg-cyan-100',
    'bg-yellow-50 text-yellow-600 hover:bg-yellow-100',
    'bg-red-50 text-red-600 hover:bg-red-100',
  ];

  if (tag) {
    const decodedTag = decodeURIComponent(tag);
    const tagPosts = getPostsByTag(decodedTag);

    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <Link
          to="/tags"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-indigo-600 mb-8 group transition-colors"
        >
          <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回所有标签
        </Link>

        <div className="mb-8 flex items-center gap-3">
          <span className="text-2xl">🏷️</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{decodedTag}</h1>
            <p className="text-sm text-gray-500">共 {tagPosts.length} 篇文章</p>
          </div>
        </div>

        {tagPosts.length === 0 ? (
          <div className="text-center py-16 text-gray-400">暂无相关文章</div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {tagPosts.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">标签分类</h1>
        <p className="text-gray-500">共 {allTags.length} 个标签，按文章数量排列</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {allTags.map((t, i) => (
          <Link
            key={t.name}
            to={`/tags/${encodeURIComponent(t.name)}`}
            className={`flex items-center justify-between px-4 py-3 rounded-xl font-medium text-sm transition-all hover:scale-105 hover:shadow-sm ${colors[i % colors.length]}`}
          >
            <span>{t.name}</span>
            <span className="text-xs opacity-60 font-normal">{t.count}</span>
          </Link>
        ))}
      </div>

      {/* All posts by tags */}
      <div className="mt-12">
        <h2 className="text-xl font-bold text-gray-800 mb-6">全部文章</h2>
        {allTags.map(t => {
          const tagPosts = getPostsByTag(t.name);
          return (
            <div key={t.name} className="mb-10">
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-lg font-semibold text-gray-700">{t.name}</h3>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t.count}</span>
              </div>
              <div className="space-y-3">
                {tagPosts.map(post => (
                  <div key={post.id} className="flex items-start gap-3 group">
                    <span className="text-gray-300 mt-1 text-sm">—</span>
                    <div>
                      <Link
                        to={`/post/${post.slug}`}
                        className="text-gray-700 hover:text-indigo-600 font-medium transition-colors group-hover:underline"
                      >
                        {post.title}
                      </Link>
                      <span className="ml-3 text-xs text-gray-400">{post.date}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
