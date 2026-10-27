# Tests lock.rb on ../positions.tsv: ruby -w test.rb [positions.tsv]
require_relative 'lock'

path = ARGV[0] || File.expand_path('../positions.tsv', __dir__)
n = bad = 0
File.foreach(path) do |line|
  next if line.start_with?('#') || line.strip.empty?

  fen, white, black = line.chomp.split("\t")
  p = Lock.from_fen(fen)
  got = [Lock.cannot_be_mated(p, true), Lock.cannot_be_mated(p, false)]
  if got != [white == '1', black == '1']
    bad += 1
    puts "wrong: #{fen} expected #{white} #{black} got #{got[0] ? 1 : 0} #{got[1] ? 1 : 0}" if bad <= 10
  end
  n += 1
end
puts "ruby: #{n} positions, #{bad} wrong"
exit(bad > 0 ? 1 : 0)
