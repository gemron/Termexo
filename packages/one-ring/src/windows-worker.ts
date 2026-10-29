import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Resolve npm's launcher to the native binary; never interpolate Worker arguments into cmd.exe.
export function windowsCodexExecutable(command = 'codex'): string {
  const candidates = path.isAbsolute(command) || /[\\/]/.test(command)
    ? [path.resolve(command)]
    : (process.env.PATH || '').split(path.delimiter).flatMap(directory => [path.join(directory, command), path.join(directory, `${command}.exe`), path.join(directory, `${command}.cmd`)]);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (path.extname(candidate).toLowerCase() === '.exe') return candidate;
    if (!/codex\.cmd$/i.test(candidate)) continue;
    const packageFile = path.join(path.dirname(candidate), 'node_modules/@openai/codex/package.json');
    if (!existsSync(packageFile)) continue;
    const require = createRequire(packageFile);
    const platform = `@openai/codex-win32-${process.arch}`;
    try {
      const platformDirectory = path.dirname(require.resolve(`${platform}/package.json`));
      const target = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
      for (const leaf of ['bin', 'codex']) {
        const binary = path.join(platformDirectory, `vendor/${target}-pc-windows-msvc/${leaf}/codex.exe`);
        if (existsSync(binary)) return binary;
      }
    } catch { /* Try the next installed launcher. */ }
  }
  throw new Error(`Cannot resolve a native Windows Codex executable from ${command}. Install the official Codex CLI or supply its codex.exe path.`);
}

// The supervisor creates the Worker suspended and assigns a kill-on-close Job Object before
// allowing any code to run. Descendants cannot escape the job by outliving their parent.
const supervisor = String.raw`
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class OneRingWorkerJob {
  [StructLayout(LayoutKind.Sequential)] struct Startup {
    public int cb; public IntPtr reserved, desktop, title;
    public int x,y,xSize,ySize,xChars,yChars,fill,flags;
    public short show,reservedSize; public IntPtr reservedBytes,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint count; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits basic; public Io io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting { public long a,b,c,d; public uint faults,total,active,terminated; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits limits,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting info,uint size,IntPtr length);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int handle);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var result=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) { if(c=='\\') { slashes++; continue; } if(c=='"') result.Append('\\',slashes*2+1); else result.Append('\\',slashes); slashes=0; result.Append(c); }
    result.Append('\\',slashes*2); return result.Append('"').ToString();
  }
  public static int Run(string exe,string[] args,string cwd,string stop,string receipt,int owner) {
    IntPtr job=IntPtr.Zero; var child=new ProcessInfo(); bool stopped=false,assigned=false; uint code=125;
    try {
      job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
      var limits=new ExtendedLimits(); limits.basic.flags=0x2000;
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)));
      var startup=new Startup(); startup.cb=Marshal.SizeOf(startup); startup.flags=0x100;
      startup.input=GetStdHandle(-10); startup.output=GetStdHandle(-11); startup.error=GetStdHandle(-12);
      var command=new StringBuilder(Quote(exe)); foreach(var arg in args) command.Append(' ').Append(Quote(arg));
      Check(CreateProcess(exe,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref startup,out child));
      Check(AssignProcessToJobObject(job,child.process)); assigned=true; Check(ResumeThread(child.thread)!=uint.MaxValue);
      using(var parent=System.Diagnostics.Process.GetProcessById(owner)) {
        while(WaitForSingleObject(child.process,50)==258) { if(File.Exists(stop)||parent.HasExited) { Check(TerminateJobObject(job,130)); break; } }
      }
      Check(GetExitCodeProcess(child.process,out code));
    } catch(Exception error) { Console.Error.WriteLine("Windows Worker Job: "+error.Message); code=125; }
    finally {
      if(job!=IntPtr.Zero) {
        TerminateJobObject(job,130);
        for(int i=0;i<100;i++) {
          Accounting accounting;
          if(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero) && accounting.active==0) { stopped=true; break; }
          Thread.Sleep(50);
        }
      }
      // Assignment failure must also stop the still-suspended process.
      if(!assigned && child.process!=IntPtr.Zero) { TerminateProcess(child.process,130); stopped=WaitForSingleObject(child.process,5000)==0; }
      if(child.thread!=IntPtr.Zero) CloseHandle(child.thread);
      if(child.process!=IntPtr.Zero) CloseHandle(child.process);
      if(job!=IntPtr.Zero) CloseHandle(job);
      if(stopped) File.WriteAllText(receipt,"stopped");
    }
    return (int)code;
  }
}
`;

export function windowsWorkerCommand(executable: string, args: string[], cwd: string, directory: string) {
  const source = path.join(directory, 'worker-job.cs');
  const stop = path.join(directory, 'worker-stop');
  const receipt = path.join(directory, 'worker-stopped');
  rmSync(stop, { force: true });
  rmSync(receipt, { force: true });
  writeFileSync(source, supervisor);
  const payload = Buffer.from(JSON.stringify({ executable, args, cwd, stop, receipt, owner: process.pid })).toString('base64');
  const source64 = Buffer.from(source).toString('base64');
  const script = `$ErrorActionPreference='Stop'; try { Add-Type -Path ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source64}'))); $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json; exit ([OneRingWorkerJob]::Run($p.executable,[string[]]$p.args,$p.cwd,$p.stop,$p.receipt,$p.owner)) } catch { [Console]::Error.WriteLine($_); exit 125 }`;
  return {
    executable: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    stop: () => writeFileSync(stop, ''),
    stopped: () => windowsWorkerStopped(directory),
  };
}

export function windowsWorkerStopped(directory: string): boolean {
  try { return readFileSync(path.join(directory, 'worker-stopped'), 'utf8') === 'stopped'; }
  catch { return false; }
}
