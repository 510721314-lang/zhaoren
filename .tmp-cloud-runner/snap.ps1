Add-Type -AssemblyName System.Drawing
$x = [int]$args[0]; $y = [int]$args[1]; $w = [int]$args[2]; $h = [int]$args[3]
$out = $args[4]
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"saved $out"
