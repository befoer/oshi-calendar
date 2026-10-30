using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;

internal static class PortableUpdater
{
    private static readonly string Folder = AppDomain.CurrentDomain.BaseDirectory;
    private static string Target;
    private static string Backup;
    private static bool Replaced;
    private static Process NewProcess;

    private static void Verify(string path, string expected)
    {
        using (var stream = File.OpenRead(path))
        using (var hash = SHA512.Create())
            if (Convert.ToBase64String(hash.ComputeHash(stream)) != expected)
                throw new IOException("Update checksum failed.");
    }

    private static void Retry(Action action)
    {
        for (int i = 0; ; i++)
            try { action(); return; }
            catch (IOException) { if (i >= 120) throw; Thread.Sleep(500); }
            catch (UnauthorizedAccessException) { if (i >= 120) throw; Thread.Sleep(500); }
    }

    private static Process Start(bool acknowledge)
    {
        var info = new ProcessStartInfo(Target);
        info.WorkingDirectory = Path.GetDirectoryName(Target);
        info.UseShellExecute = false;
        info.EnvironmentVariables.Remove("PORTABLE_EXECUTABLE_DIR");
        info.EnvironmentVariables.Remove("PORTABLE_EXECUTABLE_FILE");
        info.EnvironmentVariables.Remove("PORTABLE_EXECUTABLE_APP_FILENAME");
        info.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        if (acknowledge) info.EnvironmentVariables["OSHI_PORTABLE_UPDATE_ACK"] = Path.Combine(Folder, "started");
        else info.EnvironmentVariables.Remove("OSHI_PORTABLE_UPDATE_ACK");
        return Process.Start(info);
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 3) return 2;
            Target = Path.GetFullPath(args[1]);
            Backup = Path.Combine(Folder, "previous.exe");
            var next = Path.Combine(Folder, "new.exe");
            if (!String.Equals(Path.GetDirectoryName(Target), Path.GetDirectoryName(Folder.TrimEnd(Path.DirectorySeparatorChar)), StringComparison.OrdinalIgnoreCase)
                || !String.Equals(Path.GetExtension(Target), ".exe", StringComparison.OrdinalIgnoreCase))
                throw new IOException("Invalid update target.");
            Verify(next, args[2]);
            var parent = Process.GetProcessById(Int32.Parse(args[0]));
            File.WriteAllText(Path.Combine(Folder, "helper-ready"), "ready");
            if (!parent.WaitForExit(60000)) throw new IOException("Application did not exit. Update cancelled.");

            // The portable launcher exits after Electron and may hold the outer EXE a little longer.
            Retry(delegate { using (File.Open(Target, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } });
            Retry(delegate { File.Replace(next, Target, Backup); });
            Replaced = true;
            Verify(Target, args[2]);
            NewProcess = Start(true);
            for (int i = 0; i < 360; i++)
            {
                if (File.Exists(Path.Combine(Folder, "started")))
                {
                    File.WriteAllText(Path.Combine(Folder, "result.log"), "Update completed. Previous EXE retained as previous.exe.");
                    return 0;
                }
                if (NewProcess.HasExited) throw new IOException("New version exited before startup completed.");
                Thread.Sleep(500);
            }
            throw new IOException("New version did not finish startup. Restoring previous version.");
        }
        catch (Exception error)
        {
            try
            {
                if (Replaced && File.Exists(Backup))
                {
                    if (NewProcess != null && !NewProcess.HasExited)
                    {
                        using (var stop = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + NewProcess.Id + " /T /F") { CreateNoWindow = true, UseShellExecute = false })) stop.WaitForExit(15000);
                    }
                    Retry(delegate { File.Replace(Backup, Target, Path.Combine(Folder, "failed.exe")); });
                    Start(false);
                }
                File.WriteAllText(Path.Combine(Folder, "result.log"), error.ToString());
            }
            catch (Exception rollback) { error = new Exception(error.Message + "\nRestore failed: " + rollback.Message, error); }
            MessageBox.Show("更新未完成，原有数据已保留。\n" + error.Message + "\n日志：" + Folder, "推日更新", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }
}
