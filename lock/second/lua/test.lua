-- Tests lock.lua on ../positions.tsv: lua5.4 test.lua [positions.tsv]   (or lua test.lua; Lua 5.3 or later)
local lock = require("lock")

local path = arg[1] or "../positions.tsv"
local n, bad = 0, 0
for line in io.lines(path) do
  if line:sub(1, 1) ~= "#" and line:match("%S") then
    local fen, white, black = line:match("^([^\t]*)\t([^\t]*)\t([^\t]*)$")
    local p = lock.from_fen(fen)
    local w, b = lock.cannot_be_mated(p, true), lock.cannot_be_mated(p, false)
    if w ~= (white == "1") or b ~= (black == "1") then
      bad = bad + 1
      if bad <= 10 then
        print(("wrong: %s expected %s %s got %d %d"):format(fen, white, black, w and 1 or 0, b and 1 or 0))
      end
    end
    n = n + 1
  end
end
print(("lua: %d positions, %d wrong"):format(n, bad))
os.exit(bad > 0 and 1 or 0)
