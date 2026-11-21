# Tests lock.cr on ../positions.tsv: crystal run --release test.cr -- [positions.tsv]
require "./lock"

path = ARGV[0]? || "../positions.tsv"
n = bad = 0
File.each_line(path) do |line|
  next if line.starts_with?('#') || line.blank?
  fen, white, black = line.split('\t')
  p = Lock.from_fen(fen)
  got = {Lock.cannot_be_mated(p, true), Lock.cannot_be_mated(p, false)}
  if got != {white == "1", black == "1"}
    bad += 1
    puts "wrong: #{fen} expected #{white} #{black} got #{got[0] ? 1 : 0} #{got[1] ? 1 : 0}" if bad <= 10
  end
  n += 1
end
puts "crystal: #{n} positions, #{bad} wrong"
exit(bad > 0 ? 1 : 0)
