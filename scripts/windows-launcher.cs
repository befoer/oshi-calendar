using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("推日启动器")]
[assembly: AssemblyDescription("角色创作日历的 Windows 启动器")]
[assembly: AssemblyProduct("推日 · 角色创作日历")]
[assembly: AssemblyVersion("1.0.0.0")]

internal static class Launcher
{
    internal static readonly string Workspace = AppDomain.CurrentDomain.BaseDirectory;
    internal static readonly string LogPath = Path.Combine(Workspace, "huiqi-launcher.log");

    [STAThread]
    private static int Main(string[] args)
    {
        // Verify the real startup path without opening UI or the browser.
        if (Array.IndexOf(args, "--check") >= 0)
        {
            Environment.SetEnvironmentVariable("HUIQI_NO_OPEN", "1");
            try { Run(null); return 0; }
            catch (Exception error) { WriteLog(error.Message); return 1; }
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new LauncherWindow()) Application.Run(window);
        return 0;
    }

    private static string FindNode()
    {
        var candidates = new System.Collections.Generic.List<string>();
        candidates.Add(Path.Combine(Workspace, "node.exe"));
        foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            if (String.IsNullOrWhiteSpace(folder)) continue;
            try { candidates.Add(Path.Combine(folder.Trim().Trim('"'), "node.exe")); }
            catch (ArgumentException) { }
        }
        candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"));
        candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"));
        candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe"));
        foreach (var candidate in candidates) if (File.Exists(candidate)) return Path.GetFullPath(candidate);
        throw new InvalidOperationException("未找到 Node.js。请安装 Node.js 22.12 或更新版本（推荐 24），然后重新双击推日.exe。\r\n下载地址：https://nodejs.org");
    }

    private static void WriteLog(string message)
    {
        try { File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + message + Environment.NewLine, Encoding.UTF8); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    internal static void Run(Action<string> update)
    {
        if (!File.Exists(Path.Combine(Workspace, "scripts", "launch.mjs")) || !File.Exists(Path.Combine(Workspace, "package.json")))
            throw new InvalidOperationException("缺少项目文件。请将推日.exe 放在项目目录中，与 start.cmd、package.json 和 scripts 文件夹放在一起。\r\n可创建桌面快捷方式，不要单独移动 exe 文件。");
        var node = FindNode();
        WriteLog("启动工作空间：" + Workspace);
        string lastLine = "";
        object outputLock = new object();
        using (var process = new Process())
        {
            process.StartInfo = new ProcessStartInfo {
                FileName = node,
                Arguments = "scripts\\launch.mjs",
                WorkingDirectory = Workspace,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            process.StartInfo.EnvironmentVariables["PATH"] = Path.GetDirectoryName(node) + ";" + (Environment.GetEnvironmentVariable("PATH") ?? "");
            DataReceivedEventHandler receive = delegate(object sender, DataReceivedEventArgs e) {
                if (String.IsNullOrWhiteSpace(e.Data)) return;
                lock (outputLock) { lastLine = e.Data; WriteLog(e.Data); }
                if (update == null) return;
                if (e.Data.StartsWith("Installing dependencies")) update("首次启动正在安装依赖，请保持联网…");
                else if (e.Data.StartsWith("Building Huiqi")) update("正在准备最新版日历，请稍候…");
                else if (e.Data.StartsWith("Huiqi ready")) update("日历已启动，正在打开浏览器…");
            };
            process.OutputDataReceived += receive;
            process.ErrorDataReceived += receive;
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            process.WaitForExit();
            if (process.ExitCode != 0)
                throw new InvalidOperationException("启动失败，请查看 huiqi-launcher.log 和 huiqi-server.log。\r\n" + lastLine);
        }
    }

    private sealed class LauncherWindow : Form
    {
        private readonly Label status;
        private readonly ProgressBar progress;
        private readonly Button close;
        private readonly Button logs;
        private readonly BackgroundWorker worker;
        internal LauncherWindow()
        {
            Text = "推日 · 启动创作日历";
            ClientSize = new Size(420, 190);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Microsoft YaHei UI", 10);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(246, 245, 251);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
            Controls.Add(new Label { Text = "推日 · 角色创作日历", Location = new Point(24, 20), AutoSize = true, Font = new Font(Font, FontStyle.Bold), ForeColor = Color.FromArgb(69, 64, 196) });
            status = new Label { Text = "正在启动本地日历…", Location = new Point(24, 56), Size = new Size(370, 46) };
            progress = new ProgressBar { Location = new Point(24, 110), Size = new Size(370, 7), Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 40 };
            close = new Button { Text = "关闭", Location = new Point(310, 143), Size = new Size(84, 30), Visible = false };
            logs = new Button { Text = "查看日志", Location = new Point(212, 143), Size = new Size(90, 30), Visible = false };
            close.Click += delegate { Close(); };
            logs.Click += delegate { if (File.Exists(LogPath)) Process.Start(new ProcessStartInfo("notepad.exe", "\"" + LogPath + "\"") { UseShellExecute = true }); };
            Controls.AddRange(new Control[] { status, progress, close, logs });
            worker = new BackgroundWorker { WorkerReportsProgress = true };
            worker.DoWork += delegate { Run(delegate(string message) { worker.ReportProgress(0, message); }); };
            worker.ProgressChanged += delegate(object sender, ProgressChangedEventArgs e) { status.Text = (string)e.UserState; };
            worker.RunWorkerCompleted += delegate(object sender, RunWorkerCompletedEventArgs e) {
                if (e.Error == null) { Close(); return; }
                WriteLog(e.Error.Message);
                progress.Visible = false;
                status.Text = "启动失败。详细原因已显示，可查看日志后重试。";
                close.Visible = logs.Visible = true;
                if (!Visible) Show();
                MessageBox.Show(this, e.Error.Message, "推日启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            Shown += delegate { worker.RunWorkerAsync(); };
            // Closing the small launcher window leaves startup and the server running.
            FormClosing += delegate(object sender, FormClosingEventArgs e) { if (worker.IsBusy) { e.Cancel = true; Hide(); } };
        }
    }
}
