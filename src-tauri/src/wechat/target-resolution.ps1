# Pure parser shared by the desktop adapter and fixture tests. No UI interaction.
function Resolve-SearchRows($rows, [string]$target) {
    $section = ''
    $matchedIndices = @()
    $truncated = $false
    for ($index=0; $index -lt $rows.Count; $index++) {
        $row = $rows[$index]
        if ([string]::IsNullOrEmpty($row.Id)) {
            if ($row.Name -in @('功能','Functions')) { $section = 'function' }
            elseif ($row.Name -in @('联系人','Contacts')) { $section = 'contact' }
            elseif ($row.Name -in @('群聊','Groups','Group Chats')) { $section = 'group' }
            elseif ($row.Name -in @('最常使用','Most Used')) { $section = 'recent' }
            elseif ($row.Name -match '^(查看全部|View all|See all)') {
                if ($section -in @('contact','group','recent')) { $truncated = $true }
            } else { $section = '' }
            continue
        }
        if ($row.Name -cne $target) { continue }
        if ($target -ceq '文件传输助手') {
            if ($section -eq 'function' -and $row.Id -ceq 'search_item_function_文件传输助手') {
                $matchedIndices += $index
            }
        } elseif ($section -in @('contact','group','recent') -and (
            $row.Id -ceq ('search_item_' + $row.Name) -or
            $row.Id.StartsWith('search_item_' + $section + '_', [StringComparison]::Ordinal)
        )) { $matchedIndices += $index }
    }
    # The default helper is a specific function, independent of similarly named contacts.
    return @{Indices=@($matchedIndices); Truncated=($truncated -and $target -cne '文件传输助手')}
}
