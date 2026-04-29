import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';

// 图片数据配置 - 在这里添加你的图片组
const albums: Record<string, {
  title: string;
  description: string;
  cover: string;
  images: { src: string; caption?: string }[];
}> = {
  'nature': {
    title: '自然风光',
    description: '记录大自然的美丽瞬间',
    cover: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800',
    images: [
      { src: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200', caption: '云海日出' },
      { src: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200', caption: '森林晨雾' },
      { src: 'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=1200', caption: '湖光山色' },
      { src: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200', caption: '草原日落' },
      { src: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200', caption: '山间小路' },
      { src: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=1200', caption: '林间溪流' },
    ],
  },
  'city': {
    title: '城市建筑',
    description: '现代都市的建筑美学',
    cover: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=800',
    images: [
      { src: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1200', caption: '纽约夜景' },
      { src: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1200', caption: '城市天际线' },
      { src: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1200', caption: '都市生活' },
      { src: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=1200', caption: '建筑线条' },
    ],
  },
  'travel': {
    title: '旅行记忆',
    description: '走过的路，看过的风景',
    cover: 'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=800',
    images: [
      { src: 'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=1200', caption: '星空营地' },
      { src: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200', caption: '热带海滩' },
      { src: 'https://images.unsplash.com/photo-1530789253388-582c481c54b0?w=1200', caption: '沙漠驼队' },
      { src: 'https://images.unsplash.com/photo-1504150558240-0b4fd8946624?w=1200', caption: '古镇小巷' },
    ],
  },
};

export default function GalleryPage() {
  const { album } = useParams<{ album: string }>();
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // 如果没有指定相册，显示相册列表
  if (!album) {
    const filteredAlbums = Object.entries(albums).filter(([, data]) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        data.title.toLowerCase().includes(q) ||
        data.description.toLowerCase().includes(q)
      );
    });

    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">图片相册</h1>
        <p className="text-gray-600 mb-6">选择一个相册开始浏览</p>

        {/* 搜索框 */}
        <div className="relative mb-8 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="搜索相册..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-gray-200 bg-white shadow-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* 搜索结果提示 */}
        {searchQuery && (
          <p className="text-sm text-gray-500 mb-4">
            {filteredAlbums.length > 0
              ? `找到 ${filteredAlbums.length} 个相册`
              : '没有找到匹配的相册'}
          </p>
        )}

        {/* 相册列表 */}
        {filteredAlbums.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAlbums.map(([key, data]) => (
              <Link
                key={key}
                to={`/gallery/${key}`}
                className="group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300"
              >
                <div className="aspect-[4/3] overflow-hidden">
                  <img
                    src={data.cover}
                    alt={data.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-5">
                  <h2 className="text-xl font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
                    {data.title}
                  </h2>
                  <p className="text-gray-500 text-sm mt-1">{data.description}</p>
                  <p className="text-indigo-600 text-sm mt-3 font-medium">
                    {data.images.length} 张图片 →
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <svg className="w-16 h-16 text-gray-200 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <p className="text-gray-500 text-lg">没有找到 "<span className="font-medium text-gray-700">{searchQuery}</span>" 相关的相册</p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-4 text-indigo-600 hover:text-indigo-700 text-sm font-medium"
            >
              清除搜索
            </button>
          </div>
        )}
      </div>
    );
  }

  const currentAlbum = albums[album];

  // 相册不存在
  if (!currentAlbum) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">相册不存在</h1>
        <p className="text-gray-600 mb-8">没有找到名为 "{album}" 的相册</p>
        <Link
          to="/gallery"
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          ← 返回相册列表
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          to="/gallery"
          className="flex items-center gap-2 text-gray-600 hover:text-indigo-600 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          相册列表
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">{currentAlbum.title}</h1>
      </div>

      {/* 图片网格 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {currentAlbum.images.map((image, index) => (
          <button
            key={index}
            onClick={() => setSelectedImage(index)}
            className="group relative aspect-square overflow-hidden rounded-xl bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            <img
              src={image.src}
              alt={image.caption || `图片 ${index + 1}`}
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
          </button>
        ))}
      </div>

      {/* 图片计数器 */}
      <p className="text-center text-gray-500 mt-6">
        共 {currentAlbum.images.length} 张图片
      </p>

      {/* 灯箱查看器 */}
      {selectedImage !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setSelectedImage(null)}
        >
          {/* 关闭按钮 */}
          <button
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors"
            onClick={() => setSelectedImage(null)}
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* 上一张 */}
          {selectedImage > 0 && (
            <button
              className="absolute left-4 p-3 text-white/70 hover:text-white transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImage(selectedImage - 1);
              }}
            >
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* 下一张 */}
          {selectedImage < currentAlbum.images.length - 1 && (
            <button
              className="absolute right-4 p-3 text-white/70 hover:text-white transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImage(selectedImage + 1);
              }}
            >
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* 图片内容 */}
          <div className="max-w-5xl max-h-[85vh] mx-4" onClick={(e) => e.stopPropagation()}>
            <img
              src={currentAlbum.images[selectedImage].src}
              alt={currentAlbum.images[selectedImage].caption || ''}
              className="max-w-full max-h-[75vh] object-contain rounded-lg"
            />
            {currentAlbum.images[selectedImage].caption && (
              <p className="text-white text-center mt-4 text-lg">
                {currentAlbum.images[selectedImage].caption}
              </p>
            )}
            <p className="text-white/50 text-center mt-2 text-sm">
              {selectedImage + 1} / {currentAlbum.images.length}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
