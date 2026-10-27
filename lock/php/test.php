<?php
// Tests lock.php on ../positions.tsv:  php test.php [positions.tsv]
declare(strict_types=1);

use function Mateless\Lock\{cannotBeMated, fromFen};

require __DIR__ . '/lock.php';

$path = $argv[1] ?? '../positions.tsv';
$n = $bad = 0;
foreach (file($path, FILE_IGNORE_NEW_LINES) as $line) {
    if ($line === '' || $line[0] === '#') continue;
    [$fen, $white, $black] = explode("\t", $line);
    $p = fromFen($fen);
    $w = cannotBeMated($p, true);
    $b = cannotBeMated($p, false);
    if ($w !== ($white === '1') || $b !== ($black === '1')) {
        if (++$bad <= 10) echo "wrong: $fen expected $white $black got ", (int) $w, ' ', (int) $b, "\n";
    }
    $n++;
}
echo "php: $n positions, $bad wrong\n";
exit($bad ? 1 : 0);
