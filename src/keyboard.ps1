# Process PowerShell persistant : lit des commandes sur stdin.
#   K 17,16,77      -> appuie puis relâche (ordre inverse) une combinaison de codes VK
#   T <base64utf8>  -> tape un texte (format SendKeys déjà échappé)
#   F -             -> répond 'F <processus au premier plan>'
#   VS 0.35         -> volume principal (0..1)
#   MS 1 1          -> mute : flux 0 = haut-parleurs, 1 = micro ; 1 = muet, 0 = actif
#   MT 1            -> bascule le mute du flux
#   AG              -> répond 'A <volume> <muet haut-parleurs> <muet micro>'  (-1 si indisponible)
#   MC x y b n      -> souris : x y écran (-1 -1 = position actuelle), b 0 gauche 1 droit 2 milieu 3 déplacer seulement, n clics
#   MW 120          -> molette (120 = un cran vers le haut, -120 vers le bas)
#   MP              -> répond 'P x y' (position du curseur)
#   AV m v proc     -> volume d'une appli : m 0 régler, 1 muet, 2 réactiver, 3 basculer, 4 ajouter v ; v 0..1 ; répond 'V <sessions touchées>'
#   BS 50 / BG      -> luminosité de l'écran intégré (WMI) ; BG répond 'B <0..100>' (-1 si indisponible)
#   NP              -> média en cours : répond 'N <lecture 0/1> <base64 titre\nartiste>' (vide si rien)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DeckKB {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)]
  public struct PT { public int X; public int Y; }
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out PT p);
}
"@

# Audio (Core Audio). Isolé : si la compilation échoue, le clavier continue de marcher.
$audioOk = $true
try {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-44B8-AF86-24D3E02B8A2A")] class MMDeviceEnumeratorComObject { }
public class DeckAudio {
  static IAudioEndpointVolume Ep(int flow) {
    var en = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(flow, 1, out dev));
    IAudioEndpointVolume epv = null;
    var g = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref g, 23, 0, out epv));
    return epv;
  }
  public static void SetVol(float v) { Marshal.ThrowExceptionForHR(Ep(0).SetMasterVolumeLevelScalar(v, Guid.Empty)); }
  public static float GetVol() { float v; Marshal.ThrowExceptionForHR(Ep(0).GetMasterVolumeLevelScalar(out v)); return v; }
  public static void SetMute(int flow, bool m) { Marshal.ThrowExceptionForHR(Ep(flow).SetMute(m, Guid.Empty)); }
  public static bool GetMute(int flow) { bool m; Marshal.ThrowExceptionForHR(Ep(flow).GetMute(out m)); return m; }
}
"@
} catch { $audioOk = $false }

# Volume par application (sessions audio). Isolé aussi.
$sessOk = $true
try {
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
  int SetMasterVolume(float f, ref Guid ctx);
  int GetMasterVolume(out float f);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid ctx);
  int GetMute(out bool m);
}
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
  int a1(); int a2(); int a3(); int a4(); int a5(); int a6(); int a7(); int a8(); int a9();
  int b1(); int b2();
  int GetProcessId(out uint pid);
}
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
  int GetCount(out int n);
  int GetSession(int i, [MarshalAs(UnmanagedType.IUnknown)] out object s);
}
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
  int a1(); int a2();
  int GetSessionEnumerator(out IAudioSessionEnumerator e);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceS { int Activate(ref Guid id, int clsCtx, int activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumeratorS { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDeviceS endpoint); }
[ComImport, Guid("BCDE0395-E52F-44B8-AF86-24D3E02B8A2A")] class MMDeviceEnumeratorComObjectS { }
public class DeckSess {
  public static int Apply(string proc, int mode, float v) {
    var en = new MMDeviceEnumeratorComObjectS() as IMMDeviceEnumeratorS;
    IMMDeviceS dev = null;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
    var g = typeof(IAudioSessionManager2).GUID; object o = null;
    Marshal.ThrowExceptionForHR(dev.Activate(ref g, 23, 0, out o));
    var mgr = (IAudioSessionManager2)o;
    IAudioSessionEnumerator se = null;
    Marshal.ThrowExceptionForHR(mgr.GetSessionEnumerator(out se));
    int n; se.GetCount(out n); int hit = 0; Guid none = Guid.Empty;
    for (int i = 0; i < n; i++) {
      object so; se.GetSession(i, out so);
      uint pid; ((IAudioSessionControl2)so).GetProcessId(out pid);
      if (pid == 0) continue;
      string name = "";
      try { name = Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
      if (!name.Equals(proc, StringComparison.OrdinalIgnoreCase)) continue;
      var sv = (ISimpleAudioVolume)so; hit++;
      if (mode == 0) sv.SetMasterVolume(Math.Max(0f, Math.Min(1f, v)), ref none);
      else if (mode == 1) sv.SetMute(true, ref none);
      else if (mode == 2) sv.SetMute(false, ref none);
      else if (mode == 3) { bool m; sv.GetMute(out m); sv.SetMute(!m, ref none); }
      else if (mode == 4) { float cur; sv.GetMasterVolume(out cur); sv.SetMasterVolume(Math.Max(0f, Math.Min(1f, cur + v)), ref none); }
    }
    return hit;
  }
}
"@
} catch { $sessOk = $false }

# Média en cours (Windows 10/11 : SMTC). Isolé aussi.
$smtcOk = $true
try {
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
} catch { $smtcOk = $false }
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(3000); return $t.Result }

$ext = @(0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x28,0x2C,0x2D,0x2E,0x5B,0xAD,0xAE,0xAF,0xB0,0xB1,0xB2,0xB3)
function Press([int]$vk, [bool]$down) {
  $f = 0
  if ($ext -contains $vk) { $f = 1 }
  if (-not $down) { $f = $f -bor 2 }
  [DeckKB]::keybd_event([byte]$vk, 0, [uint32]$f, [UIntPtr]::Zero)
}
function Num($s) { return [double]::Parse($s, [Globalization.CultureInfo]::InvariantCulture) }
function Fmt($v) { return [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:0.###}', $v) }
function MuteOf([int]$flow) { try { if ([DeckAudio]::GetMute($flow)) { return 1 } else { return 0 } } catch { return -1 } }

[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $i = $line.IndexOf(' ')
    $cmd = if ($i -lt 0) { $line } else { $line.Substring(0, $i) }
    $arg = if ($i -lt 0) { '' } else { $line.Substring($i + 1) }
    if ($cmd -eq 'K') {
      $codes = @($arg.Split(',') | ForEach-Object { [int]$_ })
      foreach ($c in $codes) { Press $c $true }
      [array]::Reverse($codes)
      foreach ($c in $codes) { Press $c $false }
    } elseif ($cmd -eq 'F') {
      $procId = [uint32]0
      [void][DeckKB]::GetWindowThreadProcessId([DeckKB]::GetForegroundWindow(), [ref]$procId)
      $n = ''
      $pr = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($pr) { $n = $pr.ProcessName }
      [Console]::Out.WriteLine('F ' + $n)
    } elseif ($cmd -eq 'T') {
      $txt = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($arg))
      [System.Windows.Forms.SendKeys]::SendWait($txt)
    } elseif ($cmd -eq 'VS' -and $audioOk) {
      [DeckAudio]::SetVol([single][Math]::Max(0, [Math]::Min(1, (Num $arg))))
    } elseif ($cmd -eq 'MS' -and $audioOk) {
      $p = $arg.Split(' ')
      [DeckAudio]::SetMute([int]$p[0], ($p[1] -eq '1'))
    } elseif ($cmd -eq 'MT' -and $audioOk) {
      $fl = [int]$arg
      [DeckAudio]::SetMute($fl, (-not [DeckAudio]::GetMute($fl)))
    } elseif ($cmd -eq 'MC') {
      $p = $arg.Split(' ')
      $x = [int]$p[0]; $y = [int]$p[1]; $b = [int]$p[2]; $n = [int]$p[3]
      if ($x -ge 0 -and $y -ge 0) { [void][DeckKB]::SetCursorPos($x, $y) }
      if ($b -ne 3) {
        $down = @(2, 8, 0x20)[$b]; $up = @(4, 0x10, 0x40)[$b]
        for ($k = 0; $k -lt $n; $k++) { [DeckKB]::mouse_event([uint32]$down, 0, 0, 0, [UIntPtr]::Zero); [DeckKB]::mouse_event([uint32]$up, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }
      }
    } elseif ($cmd -eq 'MW') {
      [DeckKB]::mouse_event([uint32]0x800, 0, 0, [int]$arg, [UIntPtr]::Zero)
    } elseif ($cmd -eq 'MP') {
      $pt = New-Object DeckKB+PT
      [void][DeckKB]::GetCursorPos([ref]$pt)
      [Console]::Out.WriteLine('P ' + $pt.X + ' ' + $pt.Y)
    } elseif ($cmd -eq 'AV') {
      $p = $arg.Split(' ', 3)
      $hit = 0
      if ($sessOk) { try { $hit = [DeckSess]::Apply($p[2].Trim(), [int]$p[0], [single](Num $p[1])) } catch { $hit = 0 } }
      [Console]::Out.WriteLine('V ' + $hit)
    } elseif ($cmd -eq 'BS') {
      $v = [Math]::Max(0, [Math]::Min(100, [int]$arg))
      Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$v } | Out-Null
    } elseif ($cmd -eq 'BG') {
      $br = -1
      try { $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1; if ($m) { $br = [int]$m.CurrentBrightness } } catch { $br = -1 }
      [Console]::Out.WriteLine('B ' + $br)
    } elseif ($cmd -eq 'NP') {
      $out = 'N 0 '
      if ($smtcOk) {
        try {
          $mgrT = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
          $mgr = Await ($mgrT::RequestAsync()) $mgrT
          $ses = $mgr.GetCurrentSession()
          if ($ses) {
            $pr = Await ($ses.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $playing = 0; if ([int]$ses.GetPlaybackInfo().PlaybackStatus -eq 4) { $playing = 1 }
            $txt = [string]$pr.Title + "`n" + [string]$pr.Artist
            $out = 'N ' + $playing + ' ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($txt))
          }
        } catch { $out = 'N 0 ' }
      }
      [Console]::Out.WriteLine($out)
    } elseif ($cmd -eq 'AG') {
      $v = -1
      if ($audioOk) { try { $v = [DeckAudio]::GetVol() } catch { $v = -1 } }
      $sm = -1; $mm = -1
      if ($audioOk) { $sm = MuteOf 0; $mm = MuteOf 1 }
      [Console]::Out.WriteLine('A ' + (Fmt $v) + ' ' + $sm + ' ' + $mm)
    }
  } catch { }
}
