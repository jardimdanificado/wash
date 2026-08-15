(module
  (memory (import "env" "memory") 1)
  (func (export "_start") (param $pixels i32) (param $w i32) (param $h i32) (param $time f32) (param $startX i32) (param $startY i32) (param $endX i32) (param $endY i32)
    (local $x i32)
    (local $y i32)
    (local $idx i32)
    (local $tInt i32)
    (local $val i32)
    (local $cx i32)
    (local $cy i32)
    (local $dist i32)

    ;; tInt = (int)(time * 30.0)
    local.get $time
    f32.const 30.0
    f32.mul
    i32.trunc_f32_s
    local.set $tInt

    local.get $startY
    local.set $y

    (block $break_y
      (loop $loop_y
        local.get $y
        local.get $endY
        i32.ge_u
        br_if $break_y

        local.get $startX
        local.set $x

        (block $break_x
          (loop $loop_x
            local.get $x
            local.get $endX
            i32.ge_u
            br_if $break_x

            ;; idx = pixels + ((y * w + x) * 4)
            local.get $y
            local.get $w
            i32.mul
            local.get $x
            i32.add
            i32.const 2
            i32.shl
            local.get $pixels
            i32.add
            local.set $idx

            ;; cx = x - (w / 2), cy = y - (h / 2)
            local.get $x
            local.get $w
            i32.const 1
            i32.shr_u
            i32.sub
            local.set $cx

            local.get $y
            local.get $h
            i32.const 1
            i32.shr_u
            i32.sub
            local.set $cy

            ;; dist = (cx * cx + cy * cy) >> 5
            local.get $cx
            local.get $cx
            i32.mul
            local.get $cy
            local.get $cy
            i32.mul
            i32.add
            i32.const 5
            i32.shr_u
            local.set $dist

            ;; val = ((x ^ y) + (dist - tInt)) & 255
            local.get $x
            local.get $y
            i32.xor
            local.get $dist
            local.get $tInt
            i32.sub
            i32.add
            i32.const 255
            i32.and
            local.set $val

            ;; R = (val * 3) & 255
            local.get $idx
            local.get $val
            i32.const 3
            i32.mul
            i32.const 255
            i32.and
            i32.store8

            ;; G = val
            local.get $idx
            i32.const 1
            i32.add
            local.get $val
            i32.store8

            ;; B = 255 - val
            local.get $idx
            i32.const 2
            i32.add
            i32.const 255
            local.get $val
            i32.sub
            i32.store8

            ;; A = 255
            local.get $idx
            i32.const 3
            i32.add
            i32.const 255
            i32.store8

            local.get $x
            i32.const 1
            i32.add
            local.set $x
            br $loop_x
          )
        )

        local.get $y
        i32.const 1
        i32.add
        local.set $y
        br $loop_y
      )
    )
  )
)
