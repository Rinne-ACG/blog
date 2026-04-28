export default function AboutPage() {
  const skills = [
    { name: 'React / Vue', level: 90 },
    { name: 'TypeScript', level: 85 },
    { name: 'Node.js', level: 75 },
    { name: 'CSS / Tailwind', level: 88 },
    { name: '工程化 (Vite/Webpack)', level: 80 },
  ];

  const experiences = [
    {
      period: '2024 — 至今',
      role: '前端工程师',
      company: '某科技公司',
      desc: '负责前端架构设计与核心功能开发，推动工程化建设与性能优化。',
    },
    {
      period: '2022 — 2024',
      role: '全栈开发工程师',
      company: '创业公司',
      desc: '独立开发多个 Web 应用，技术栈涵盖 React、Node.js、PostgreSQL。',
    },
    {
      period: '2020 — 2022',
      role: '前端实习生',
      company: '互联网公司',
      desc: '参与 C 端产品开发，学习前端工程化最佳实践。',
    },
  ];

  const socials = [
    { name: 'GitHub', url: 'https://github.com', icon: '⚡' },
    { name: 'Twitter', url: 'https://twitter.com', icon: '🐦' },
    { name: '掘金', url: 'https://juejin.cn', icon: '✨' },
    { name: '邮件', url: 'mailto:hello@example.com', icon: '📬' },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      {/* Profile Card */}
      <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 rounded-2xl border border-indigo-100 p-8 mb-8 text-center">
        <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-4xl shadow-lg">
          👨‍💻
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">前端开发者</h1>
        <p className="text-indigo-600 text-sm font-medium mb-4">Frontend Engineer · Open Source Enthusiast</p>
        <p className="text-gray-600 leading-relaxed max-w-md mx-auto">
          热爱编程与技术分享，专注于现代前端开发领域。喜欢探索新技术，
          享受用代码解决实际问题的过程。这个博客是我的技术成长记录。
        </p>

        {/* Social links */}
        <div className="flex justify-center gap-3 mt-5">
          {socials.map(s => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors shadow-sm"
            >
              <span>{s.icon}</span>
              {s.name}
            </a>
          ))}
        </div>
      </div>

      {/* Skills */}
      <section className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
          <span>🛠️</span> 技术栈
        </h2>
        <div className="space-y-4">
          {skills.map(skill => (
            <div key={skill.name}>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="font-medium text-gray-700">{skill.name}</span>
                <span className="text-gray-400">{skill.level}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full transition-all duration-700"
                  style={{ width: `${skill.level}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Experience */}
      <section className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-bold text-gray-900 mb-5 flex items-center gap-2">
          <span>💼</span> 经历
        </h2>
        <div className="space-y-6">
          {experiences.map((exp, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                {i < experiences.length - 1 && (
                  <div className="w-px flex-1 bg-gray-200 mt-1" />
                )}
              </div>
              <div className="pb-6 flex-1">
                <div className="text-xs text-gray-400 mb-1">{exp.period}</div>
                <div className="font-semibold text-gray-800">{exp.role}</div>
                <div className="text-sm text-indigo-600 mb-1">{exp.company}</div>
                <div className="text-sm text-gray-500 leading-relaxed">{exp.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Blog Info */}
      <section className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <span>📝</span> 关于本博客
        </h2>
        <p className="text-gray-600 leading-relaxed text-sm mb-4">
          本博客使用 <strong>React 18 + TypeScript + Vite + Tailwind CSS</strong> 构建，
          支持 Markdown 渲染、代码高亮、标签分类等功能。内容以前端开发为主，
          不定期更新技术文章。
        </p>
        <div className="flex flex-wrap gap-2">
          {['React', 'TypeScript', 'Vite', 'Tailwind CSS', 'Markdown'].map(tech => (
            <span key={tech} className="px-3 py-1 text-xs rounded-full bg-gray-100 text-gray-600 font-medium">
              {tech}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
