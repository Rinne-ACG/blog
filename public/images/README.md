# 图片文件夹说明

此目录用于存放博客相册页面的图片。

## 目录结构

```
public/images/
├── nature/          # 自然风光相册
├── city/            # 城市建筑相册
├── travel/          # 旅行记忆相册
└── README.md        # 本说明文件
```

## 使用方法

1. 将你的图片放入对应相册的子文件夹中
2. 打开 `src/pages/GalleryPage.tsx`
3. 修改 `albums` 对象中的 `cover` 和 `images[].src` 字段
4. 本地图片路径格式：`/images/相册名/文件名.jpg`

## 图片路径示例

```tsx
// 封面图（相册列表页显示）
cover: '/images/nature/cover.jpg',

// 相册内的图片
images: [
  { src: '/images/nature/photo1.jpg', caption: '图片标题' },
  { src: '/images/nature/photo2.jpg', caption: '图片标题' },
]
```

## 支持的图片格式

推荐使用：`.jpg` / `.jpeg` / `.png` / `.webp`

## 注意事项

- `public/` 目录下的文件会被原样复制到构建产物，路径以 `/` 开头
- 建议图片尺寸：封面图 800×600px 以上，展示图 1200px 宽以上
- 如需添加新相册，在 `GalleryPage.tsx` 中新增对应配置即可
