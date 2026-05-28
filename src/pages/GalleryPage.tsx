import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';

// ============================================================
// 图片数据配置
// ------------------------------------------------------------
// 【如何替换成你自己的图片】
//
// 1. 把图片文件放入 public/images/<相册名>/ 对应的文件夹里
//    例如：public/images/nature/photo1.jpg
//
// 2. 将下方 cover 和 images[].src 中的路径改为：
//    /images/<相册名>/<文件名>
//    例如：cover: '/images/nature/cover.jpg'
//
// 3. 修改 title / description / caption 为你想要的文字
//
// 4. 如需新增相册，仿照下方格式继续添加即可
// ============================================================
const albums: Record<string, {
  title: string;
  description: string;
  cover: string;
  images: { src: string; caption?: string }[];
}> = {
  '2604014': {
    title: '2604014',
    description: '2604014不良记录图片',
    cover: '/images/2604014/2604014流转单.jpg',
    images: [
      { src: '/images/2604014/2604014流转单.jpg', caption: '2604014流转单' },
      { src: '/images/2604014/一次老化.jpg', caption: '一次老化' },
      { src: '/images/2604014/一次老化电压.jpg', caption: '一次老化电压' },
      { src: '/images/2604014/二次老化.jpg', caption: '二次老化' },
      { src: '/images/2604014/二次老化电压.jpg', caption: '二次老化电压' },
    ],
  },
  '2604131': {
    title: '2604131',
    description: '2604131不良记录图片',
    cover: '/images/2604131/2604131流转单.jpg',
    images: [
      { src: '/images/2604131/2604131流转单.jpg', caption: '2604131流转单' },
      { src: '/images/2604131/一次老化.jpg', caption: '一次老化' },
      { src: '/images/2604131/一次老化电压.jpg', caption: '一次老化电压' },
      { src: '/images/2604131/二次老化.jpg', caption: '二次老化' },
      { src: '/images/2604131/二次老化电压.jpg', caption: '二次老化电压' },
      { src: '/images/2604131/异常处理单.jpg', caption: '异常处理单' },
      { src: '/images/2604131/拆解图.jpg', caption: '拆解图' },
    ],
  },
  '2604280': {
    title: '2604280',
    description: '2604280不良记录图片',
    cover: '/images/2604280/1ddb6214ca54a7e62852986c81864c64.jpg',
    images: [
      { src: '/images/2604280/1ddb6214ca54a7e62852986c81864c64.jpg' },
      { src: '/images/2604280/553e33b1983a8ff56ebb7693999b9c94.jpg' },
      { src: '/images/2604280/793fe46adc1a834895760e4024734cb2.jpg' },
      { src: '/images/2604280/d138a09f653d1f0b4e32e664989991b8.jpg' },
    ],
  },
  '2605023': {
    title: '2605023',
    description: '2605023不良记录图片',
    cover: '/images/2605023/44d29dd85e92a0c3a04766c3ef342487.jpg',
    images: [
      { src: '/images/2605023/44d29dd85e92a0c3a04766c3ef342487.jpg' },
      { src: '/images/2605023/57d05237025735a1aab6693f440af6a5.jpg' },
      { src: '/images/2605023/b9ad172dca94cd6cdfd766fe2e23b4de.jpg' },
      { src: '/images/2605023/ccaf121e09b0e75141ea134dc4df03db.jpg' },
    ],
  },
  '2605030': {
    title: '2605030',
    description: '2605030不良记录图片',
    cover: '/images/2605030/13594f7355516d7d6a63ed6105ed5d9c.jpg',
    images: [
      { src: '/images/2605030/13594f7355516d7d6a63ed6105ed5d9c.jpg' },
      { src: '/images/2605030/1f569c35cfb25e0b14eee0aae5ea652c.jpg' },
      { src: '/images/2605030/ac79da3d9fbdf1ee428bdbdc85613894.jpg' },
      { src: '/images/2605030/e7dedd147af9cf8f38156a58abe16754.jpg' },
      { src: '/images/2605030/e810f405c51f5bd4f36df5e9c06e35af.jpg' },
      { src: '/images/2605030/e921b62ec38f26361c0068e757ed6791.jpg' },
    ],
  },
  '2605037': {
    title: '2605037',
    description: '2605037不良记录图片',
    cover: '/images/2605037/29e29eaf2b919a8a6271d443d6e72bb1.jpg',
    images: [
      { src: '/images/2605037/29e29eaf2b919a8a6271d443d6e72bb1.jpg' },
      { src: '/images/2605037/3ba9226269ad551d0bcc6caf4295aa1a.jpg' },
      { src: '/images/2605037/76390c14d8e2a78cdc4aa157f28bbfdc.jpg' },
      { src: '/images/2605037/7c9a010f22c8c4e32478eb882ea1529f.jpg' },
    ],
  },
  '2605076': {
    title: '2605076',
    description: '2605076不良记录图片',
    cover: '/images/2605076/482a62c807dd4234b0787ddd2e51edbe.jpg',
    images: [
      { src: '/images/2605076/482a62c807dd4234b0787ddd2e51edbe.jpg' },
      { src: '/images/2605076/5c830ff2fc4a253b221419efba9e6597.jpg' },
      { src: '/images/2605076/60fe34e5d99ef51230671a360873dc27.jpg' },
      { src: '/images/2605076/6e15826036086716960b081196001fa7.jpg' },
    ],
  },
  '2605082': {
    title: '2605082',
    description: '2605082不良记录图片',
    cover: '/images/2605082/7c1da4c25bd19fba79d155c5c62ef579.jpg',
    images: [
      { src: '/images/2605082/7c1da4c25bd19fba79d155c5c62ef579.jpg' },
      { src: '/images/2605082/a680fa6c13cd3fdccfda4321ed7c65bc.jpg' },
      { src: '/images/2605082/b395fd46e87400dec8342ac1b1612047.jpg' },
      { src: '/images/2605082/deb0cc060d4c5e752eeea14a07761942.jpg' },
    ],
  },
  '2605091': {
    title: '2605091',
    description: '2605091不良记录图片',
    cover: '/images/2605091/479facf4ded8ed23ea6cb820ed55eac0.jpg',
    images: [
      { src: '/images/2605091/479facf4ded8ed23ea6cb820ed55eac0.jpg' },
      { src: '/images/2605091/75b50446f0cbae23b9dfcf9f60fe4f63.jpg' },
      { src: '/images/2605091/7712ec2f865a194c72f3b6fdfb9559ed.jpg' },
      { src: '/images/2605091/91c1c1fa975732d8fc1457f7fdf4bb38.jpg' },
      { src: '/images/2605091/daead0596aba890ad8c70dc4a778ef36.jpg' },
    ],
  },
  '2605108': {
    title: '2605108',
    description: '2605108不良记录图片',
    cover: '/images/2605108/08ddb921a36ea2b1b73a90d2ae39928b.jpg',
    images: [
      { src: '/images/2605108/08ddb921a36ea2b1b73a90d2ae39928b.jpg' },
      { src: '/images/2605108/2d4cff7730bf913b698284952bd15895.jpg' },
      { src: '/images/2605108/4aba45a4582795719edec98ac14ab71c.jpg' },
      { src: '/images/2605108/5c3aac88c56fa6aef020a1f801b3b415.jpg' },
      { src: '/images/2605108/62b7e39b3a2297492e714cd55bb68975.jpg' },
      { src: '/images/2605108/b4308cdbe44453073235958d8a065c1a.jpg' },
    ],
  },
  '2605140': {
    title: '2605140',
    description: '2605140不良记录图片',
    cover: '/images/2605140/0813eba9ec0d559069a94499ebd00972.jpg',
    images: [
      { src: '/images/2605140/0813eba9ec0d559069a94499ebd00972.jpg' },
      { src: '/images/2605140/f42d78b540dae0ed194db311c94b5303.jpg' },
      { src: '/images/2605140/f99b3598e62bc3fe7f064fe992faea75.jpg' },
      { src: '/images/2605140/fa54eaa1a860f163df078ee158ab163d.jpg' },
    ],
  },
  'travel': {
    title: '旅行记忆',
    description: '走过的路，看过的风景',
    // 替换为：'/images/travel/cover.jpg'
    cover: 'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=800',
    images: [
      // 替换为：{ src: '/images/travel/photo1.jpg', caption: '图片标题' }
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
