# Shortcuts through the Unicode shell interface. WScript.Shell passes paths and arguments
# through the system code page, so characters outside it (for example Japanese folder names
# on an English Windows) become '?' and the shortcut points nowhere.
if (-not ('FussennShortcut' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FussennShortcut {
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellLinkW {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, IntPtr data, uint flags);
        void GetIDList(out IntPtr list);
        void SetIDList(IntPtr list);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short key);
        void SetHotkey(short key);
        void GetShowCmd(out int show);
        void SetShowCmd(int show);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
    }
    [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPersistFile {
        void GetClassID(out Guid id);
        [PreserveSig] int IsDirty();
        void Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
        void Save([MarshalAs(UnmanagedType.LPWStr)] string file, bool remember);
        void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
        void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
    }
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    class ShellLink {}
    public static string[] Read(string path) {
        var link = (IShellLinkW)new ShellLink();
        ((IPersistFile)link).Load(path, 0);
        var target = new StringBuilder(32768); link.GetPath(target, target.Capacity, IntPtr.Zero, 0);
        var arguments = new StringBuilder(32768); link.GetArguments(arguments, arguments.Capacity);
        var directory = new StringBuilder(32768); link.GetWorkingDirectory(directory, directory.Capacity);
        var icon = new StringBuilder(32768); int index; link.GetIconLocation(icon, icon.Capacity, out index);
        return new[] { target.ToString(), arguments.ToString(), directory.ToString(), icon.ToString() + "," + index };
    }
    public static void Write(string path, string target, string arguments, string directory, string description, string icon, int index, int show) {
        var link = (IShellLinkW)new ShellLink();
        // Update an existing shortcut in place, so settings made by the user (such as a hotkey) stay.
        if (System.IO.File.Exists(path)) ((IPersistFile)link).Load(path, 0);
        link.SetPath(target); link.SetArguments(arguments); link.SetWorkingDirectory(directory);
        link.SetDescription(description); link.SetIconLocation(icon, index); link.SetShowCmd(show);
        ((IPersistFile)link).Save(path, true);
    }
}
'@
}
function Read-FussennShortcut([string]$Path) {
    $values = [FussennShortcut]::Read($Path)
    return [ordered]@{ target = $values[0]; arguments = $values[1]; workingDirectory = $values[2]; icon = $values[3] }
}
function Save-FussennShortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$WorkingDirectory, [string]$Description, [string]$Icon, [int]$IconIndex, [int]$ShowCommand) {
    [FussennShortcut]::Write($Path, $Target, $Arguments, $WorkingDirectory, $Description, $Icon, $IconIndex, $ShowCommand)
}
